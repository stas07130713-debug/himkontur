import type { GeoPoint } from './types';

export type WeatherObservation = Readonly<{
  temperatureC: number;
  windSpeedMps: number;
  windFromDegrees: number;
  cloudCoverPercent: number;
  snowDepthM: number;
  observedAt: string;
  provider: 'Open-Meteo' | 'MET Norway' | 'wttr.in';
  dataKind: 'forecast' | 'archive';
}>;

type HourlyValues = {
  time?: string[];
  temperature_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  cloud_cover?: (number | null)[];
  snow_depth?: (number | null)[];
};

type OpenMeteoResponse = { hourly?: HourlyValues };

type MetNorwayDetails = Readonly<{
  air_temperature?: number;
  wind_speed?: number;
  wind_from_direction?: number;
  cloud_area_fraction?: number;
}>;

type MetNorwayResponse = Readonly<{
  properties?: Readonly<{
    timeseries?: readonly Readonly<{
      time?: string;
      data?: Readonly<{ instant?: Readonly<{ details?: MetNorwayDetails }> }>;
    }>[];
  }>;
}>;

type WttrHourly = Readonly<{
  time?: string;
  tempC?: string;
  windspeedKmph?: string;
  winddirDegree?: string;
  cloudcover?: string;
}>;

type WttrResponse = Readonly<{
  weather?: readonly Readonly<{
    date?: string;
    hourly?: readonly WttrHourly[];
  }>[];
}>;

const DAY_MS = 86_400_000;
const RECENT_PAST_DAYS = 92;
const MAX_FORECAST_DAYS = 16;
const WEATHER_TIMEOUT_MS = 6_500;
const weatherCache = new Map<string, WeatherObservation>();

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localApiTime(value: string): number {
  return new Date(value.length === 16 ? `${value}:00` : value).getTime();
}

function numeric(values: (number | null)[] | undefined, index: number, name: string): number {
  const value = values?.[index];
  if (value === null || value === undefined || !Number.isFinite(value)) throw new Error(`Погодный сервис не вернул показатель «${name}» на выбранное время.`);
  return value;
}

function optionalNumeric(values: (number | null)[] | undefined, index: number, fallback = 0): number {
  const value = values?.[index];
  return value === null || value === undefined || !Number.isFinite(value) ? fallback : value;
}

function interpolate(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

function interpolateDirection(a: number, b: number, fraction: number): number {
  const shortest = ((b - a + 540) % 360) - 180;
  return (a + shortest * fraction + 360) % 360;
}

async function requestJson(url: string, callerSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function observationFromOpenMeteo(response: OpenMeteoResponse, target: Date, dataKind: WeatherObservation['dataKind']): WeatherObservation {
  const hourly = response.hourly;
  if (hourly?.time === undefined || hourly.time.length === 0) throw new Error('Open-Meteo не вернул почасовые данные на выбранную дату.');
  const targetMs = target.getTime();
  const times = hourly.time.map(localApiTime);
  let upper = times.findIndex((time) => time >= targetMs);
  if (upper < 0) upper = times.length - 1;
  const lower = Math.max(0, upper - (times[upper] === targetMs ? 0 : 1));
  const span = Math.max(1, (times[upper] ?? targetMs) - (times[lower] ?? targetMs));
  const fraction = lower === upper ? 0 : Math.max(0, Math.min(1, (targetMs - (times[lower] ?? targetMs)) / span));
  const pair = (values: (number | null)[] | undefined, name: string) => [numeric(values, lower, name), numeric(values, upper, name)] as const;
  const temperature = pair(hourly.temperature_2m, 'температура');
  const windSpeed = pair(hourly.wind_speed_10m, 'скорость ветра');
  const windDirection = pair(hourly.wind_direction_10m, 'направление ветра');
  const cloudCover = pair(hourly.cloud_cover, 'облачность');
  const snowDepth = [optionalNumeric(hourly.snow_depth, lower), optionalNumeric(hourly.snow_depth, upper)] as const;
  return {
    temperatureC: interpolate(temperature[0], temperature[1], fraction),
    windSpeedMps: interpolate(windSpeed[0], windSpeed[1], fraction),
    windFromDegrees: interpolateDirection(windDirection[0], windDirection[1], fraction),
    cloudCoverPercent: interpolate(cloudCover[0], cloudCover[1], fraction),
    snowDepthM: interpolate(snowDepth[0], snowDepth[1], fraction),
    observedAt: target.toISOString(),
    provider: 'Open-Meteo',
    dataKind
  };
}

function observationFromMetNorway(response: MetNorwayResponse, target: Date): WeatherObservation {
  const rows = response.properties?.timeseries?.flatMap((row) => {
    const time = row.time === undefined ? Number.NaN : Date.parse(row.time);
    const details = row.data?.instant?.details;
    return Number.isFinite(time) && details !== undefined ? [{ time, details }] : [];
  }) ?? [];
  if (rows.length === 0) throw new Error('MET Norway не вернул почасовой прогноз.');
  const targetMs = target.getTime();
  let upper = rows.findIndex((row) => row.time >= targetMs);
  if (upper < 0) upper = rows.length - 1;
  const lower = Math.max(0, upper - (rows[upper]?.time === targetMs ? 0 : 1));
  const lowerRow = rows[lower]; const upperRow = rows[upper];
  if (lowerRow === undefined || upperRow === undefined) throw new Error('MET Norway вернул неполный прогноз.');
  const value = (row: typeof lowerRow, key: keyof MetNorwayDetails, name: string): number => {
    const result = row.details[key];
    if (result === undefined || !Number.isFinite(result)) throw new Error(`MET Norway не вернул показатель «${name}».`);
    return result;
  };
  const span = Math.max(1, upperRow.time - lowerRow.time);
  const fraction = lower === upper ? 0 : Math.max(0, Math.min(1, (targetMs - lowerRow.time) / span));
  return {
    temperatureC: interpolate(value(lowerRow, 'air_temperature', 'температура'), value(upperRow, 'air_temperature', 'температура'), fraction),
    windSpeedMps: interpolate(value(lowerRow, 'wind_speed', 'скорость ветра'), value(upperRow, 'wind_speed', 'скорость ветра'), fraction),
    windFromDegrees: interpolateDirection(value(lowerRow, 'wind_from_direction', 'направление ветра'), value(upperRow, 'wind_from_direction', 'направление ветра'), fraction),
    cloudCoverPercent: interpolate(value(lowerRow, 'cloud_area_fraction', 'облачность'), value(upperRow, 'cloud_area_fraction', 'облачность'), fraction),
    snowDepthM: 0,
    observedAt: target.toISOString(),
    provider: 'MET Norway',
    dataKind: 'forecast'
  };
}

function wttrNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`wttr.in не вернул показатель «${name}».`);
  return parsed;
}

function observationFromWttr(response: WttrResponse, target: Date): WeatherObservation {
  const rows = response.weather?.flatMap((day) => {
    if (day.date === undefined) return [];
    return day.hourly?.flatMap((hour) => {
      const rawTime = Number(hour.time);
      if (!Number.isFinite(rawTime)) return [];
      const hours = Math.floor(rawTime / 100);
      const minutes = rawTime % 100;
      const time = new Date(`${day.date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`).getTime();
      return Number.isFinite(time) ? [{ time, hour }] : [];
    }) ?? [];
  }) ?? [];
  if (rows.length === 0) throw new Error('wttr.in не вернул почасовой прогноз.');

  const targetMs = target.getTime();
  let upper = rows.findIndex((row) => row.time >= targetMs);
  if (upper < 0) upper = rows.length - 1;
  const lower = Math.max(0, upper - (rows[upper]?.time === targetMs ? 0 : 1));
  const lowerRow = rows[lower]; const upperRow = rows[upper];
  if (lowerRow === undefined || upperRow === undefined) throw new Error('wttr.in вернул неполный прогноз.');
  const span = Math.max(1, upperRow.time - lowerRow.time);
  const fraction = lower === upper ? 0 : Math.max(0, Math.min(1, (targetMs - lowerRow.time) / span));
  const value = (row: typeof lowerRow, key: keyof WttrHourly, name: string): number => wttrNumber(row.hour[key], name);
  return {
    temperatureC: interpolate(value(lowerRow, 'tempC', 'температура'), value(upperRow, 'tempC', 'температура'), fraction),
    windSpeedMps: interpolate(value(lowerRow, 'windspeedKmph', 'скорость ветра'), value(upperRow, 'windspeedKmph', 'скорость ветра'), fraction) / 3.6,
    windFromDegrees: interpolateDirection(value(lowerRow, 'winddirDegree', 'направление ветра'), value(upperRow, 'winddirDegree', 'направление ветра'), fraction),
    cloudCoverPercent: interpolate(value(lowerRow, 'cloudcover', 'облачность'), value(upperRow, 'cloudcover', 'облачность'), fraction),
    // wttr.in publishes forecast snowfall, not measured snow depth on the
    // ground. Do not turn snowfall into a false automatic "snow cover" flag.
    snowDepthM: 0,
    observedAt: target.toISOString(),
    provider: 'wttr.in',
    dataKind: 'forecast'
  };
}

export async function fetchWeather(point: GeoPoint, accidentTimeIso: string, signal?: AbortSignal): Promise<WeatherObservation> {
  const target = new Date(accidentTimeIso);
  if (Number.isNaN(target.getTime())) throw new Error('Указана некорректная дата происшествия.');
  const ageDays = (Date.now() - target.getTime()) / DAY_MS;
  if (ageDays < -MAX_FORECAST_DAYS) throw new Error('Для выбранной будущей даты автоматический прогноз ещё недоступен.');

  const dataKind: WeatherObservation['dataKind'] = ageDays > RECENT_PAST_DAYS ? 'archive' : 'forecast';
  const cacheKey = `${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}:${target.toISOString().slice(0, 16)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const nextDay = new Date(target);
  nextDay.setDate(nextDay.getDate() + 1);
  const query = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    start_date: localDate(target),
    end_date: localDate(nextDay),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,snow_depth',
    wind_speed_unit: 'ms',
    timezone: 'auto'
  });
  const endpoint = dataKind === 'archive'
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const openMeteo = () => requestJson(`${endpoint}?${query}`, signal).then((payload) => observationFromOpenMeteo(payload as OpenMeteoResponse, target, dataKind));
  let observation: WeatherObservation;
  try {
    if (dataKind === 'archive') {
      observation = await openMeteo();
    } else {
      const metNorwayUrl = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
      metNorwayUrl.searchParams.set('lat', point.latitude.toFixed(5));
      metNorwayUrl.searchParams.set('lon', point.longitude.toFixed(5));
      const wttrUrl = new URL(`https://wttr.in/${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`);
      wttrUrl.searchParams.set('format', 'j1');
      // Independent providers are started together. If domains are blocked
      // by the user's operator, the first valid response is used immediately.
      observation = await Promise.any([
        openMeteo(),
        requestJson(metNorwayUrl.href, signal).then((payload) => observationFromMetNorway(payload as MetNorwayResponse, target)),
        requestJson(wttrUrl.href, signal).then((payload) => observationFromWttr(payload as WttrResponse, target))
      ]);
    }
  } catch {
    if (signal?.aborted === true) throw signal.reason;
    throw new Error('Не удалось получить погоду ни от одного независимого сервиса. Введите данные вручную и повторите проверку позднее.');
  }
  weatherCache.set(cacheKey, observation);
  return observation;
}
