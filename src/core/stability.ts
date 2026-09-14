import type { CalculationInput, Stability } from './types';

export type DayPeriod = 'night' | 'morning' | 'day' | 'evening';
export type StabilityAssessment = Readonly<{ stability: Stability; period: DayPeriod; cloud: 'clear' | 'overcast'; explanation: string }>;

const labels: Record<Stability, string> = { inversion: 'Инверсия', isothermy: 'Изотермия', convection: 'Конвекция' };
const periodLabels: Record<DayPeriod, string> = { night: 'ночь', morning: 'утро', day: 'день', evening: 'вечер' };

function dayOfYear(value: Date): number {
  const start = Date.UTC(value.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - start) / 86_400_000);
}

function solarUtcHour(date: Date, latitude: number, longitude: number, sunrise: boolean): number | null {
  const n = dayOfYear(date); const lngHour = longitude / 15;
  const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  let l = m + 1.916 * Math.sin(m * Math.PI / 180) + 0.02 * Math.sin(2 * m * Math.PI / 180) + 282.634;
  l = (l + 360) % 360;
  let ra = Math.atan(0.91764 * Math.tan(l * Math.PI / 180)) * 180 / Math.PI;
  ra = (ra + 360) % 360; ra += Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90; ra /= 15;
  const sinDec = 0.39782 * Math.sin(l * Math.PI / 180); const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * Math.PI / 180) - sinDec * Math.sin(latitude * Math.PI / 180)) / (cosDec * Math.cos(latitude * Math.PI / 180));
  if (cosH > 1 || cosH < -1) return null;
  const h = (sunrise ? 360 - Math.acos(cosH) * 180 / Math.PI : Math.acos(cosH) * 180 / Math.PI) / 15;
  return (h + ra - 0.06571 * t - 6.622 - lngHour + 24) % 24;
}

function determinePeriod(input: CalculationInput): DayPeriod {
  const accident = new Date(input.accidentTimeIso);
  const rise = solarUtcHour(accident, input.sourcePoint.latitude, input.sourcePoint.longitude, true);
  const set = solarUtcHour(accident, input.sourcePoint.latitude, input.sourcePoint.longitude, false);
  const utcHour = accident.getUTCHours() + accident.getUTCMinutes() / 60;
  if (rise === null || set === null) return accident.getUTCMonth() >= 4 && accident.getUTCMonth() <= 7 ? 'day' : 'night';
  const sinceRise = (utcHour - rise + 24) % 24; const sinceSet = (utcHour - set + 24) % 24;
  if (sinceRise < 2) return 'morning';
  if (sinceSet < 2) return 'evening';
  return sinceRise < sinceSet ? 'day' : 'night';
}

export function assessStability(input: CalculationInput): StabilityAssessment {
  const period = determinePeriod(input); const cloud = input.cloudCoverPercent >= 80 ? 'overcast' : 'clear';
  let stability: Stability = 'isothermy';
  if (input.windSpeedMps < 2 && cloud === 'clear') {
    if (period === 'night' || period === 'evening') stability = 'inversion';
    else if (period === 'day') stability = input.snowCover ? 'isothermy' : 'convection';
    else stability = input.snowCover ? 'inversion' : 'isothermy';
  } else if (input.windSpeedMps < 4 && cloud === 'clear') {
    if (period === 'night') stability = 'inversion';
    else if (period === 'morning' || period === 'evening') stability = input.snowCover ? 'inversion' : 'isothermy';
  }
  const cloudLabel = cloud === 'overcast' ? 'сплошная облачность' : 'ясно/переменная облачность';
  return { stability, period, cloud, explanation: `${labels[stability]}: ${periodLabels[period]}, ветер ${input.windSpeedMps.toLocaleString('ru-RU')} м/с, ${cloudLabel}${input.snowCover ? ', снежный покров' : ''}. Таблица В.1.` };
}

export function withAutomaticStability(input: CalculationInput): CalculationInput {
  return { ...input, stability: assessStability(input).stability };
}
