import type { GeoPoint } from './types';

export type WeatherObservation = Readonly<{
  temperatureC: number;
  windSpeedMps: number;
  windFromDegrees: number;
  cloudCoverPercent: number;
  snowDepthM: number;
  observedAt: string;
  provider: 'Open-Meteo';
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

const DAY_MS = 86_400_000;
const RECENT_PAST_DAYS = 92;
const MAX_FORECAST_DAYS = 16;

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

export async function fetchWeather(point: GeoPoint, accidentTimeIso: string, signal?: AbortSignal): Promise<WeatherObservation> {
  const target = new Date(accidentTimeIso);
  if (Number.isNaN(target.getTime())) throw new Error('Указана некорректная дата происшествия.');
  const ageDays = (Date.now() - target.getTime()) / DAY_MS;
  if (ageDays < -MAX_FORECAST_DAYS) throw new Error('Для выбранной будущей даты автоматический прогноз Open-Meteo ещё недоступен.');

  const dataKind: WeatherObservation['dataKind'] = ageDays > RECENT_PAST_DAYS ? 'archive' : 'forecast';
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
  const response = await fetch(`${endpoint}?${query}`, signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`Погодный сервис вернул HTTP ${response.status} для выбранной даты.`);
  const hourly = ((await response.json()) as OpenMeteoResponse).hourly;
  if (hourly?.time === undefined || hourly.time.length === 0) throw new Error('Погодный сервис не вернул почасовые данные на выбранную дату.');

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
