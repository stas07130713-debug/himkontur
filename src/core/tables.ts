import {
  DEPTH_KM,
  EQUIVALENT_MASS_T,
  K4_BY_WIND,
  TRANSFER_SPEED_KMH
} from './reference-data';
import type { Stability, Substance } from './types';
import { bracket, clamp, interpolate } from './math';

export type InterpolationDetails = Readonly<{ value: number; explanation: string }>;

function display(value: number): string {
  return Number(value.toFixed(2)).toString().replace('.', ',');
}

function interpolationExplanation(symbol: string, xSymbol: string, x: number, x0: number, x1: number, y0: number, y1: number, value: number): string {
  if (x0 === x1) return `${symbol} = ${display(value)} принят непосредственно из табличной строки при ${xSymbol} = ${display(x)}.`;
  return `Линейная интерполяция: ${symbol} = ${display(y0)} + (${display(x)} − ${display(x0)}) / (${display(x1)} − ${display(x0)}) × (${display(y1)} − ${display(y0)}) = ${display(value)}.`;
}

export function temperatureFactorInterpolation(
  substance: Substance,
  temperatureC: number,
  cloud: 'primary' | 'secondary'
): InterpolationDetails {
  const rows = substance.temperatureFactors;
  if (rows.length === 0) throw new Error(`Для «${substance.name}» отсутствуют температурные коэффициенты.`);
  const temperatures = rows.map((row) => row.temperatureC);
  const value = clamp(temperatureC, temperatures[0] ?? temperatureC, temperatures.at(-1) ?? temperatureC);
  const [lowIndex, highIndex] = bracket(temperatures, value);
  const low = rows[lowIndex];
  const high = rows[highIndex];
  if (low === undefined || high === undefined) throw new Error('Повреждена таблица температурных коэффициентов.');
  const result = interpolate(value, low.temperatureC, high.temperatureC, low[cloud], high[cloud]);
  const limited = value !== temperatureC ? ` Температура ${display(temperatureC)} °C ограничена диапазоном таблицы до ${display(value)} °C.` : '';
  return { value: result, explanation: `${interpolationExplanation('K7', 't', value, low.temperatureC, high.temperatureC, low[cloud], high[cloud], result)}${limited}` };
}

export function interpolateTemperatureFactor(
  substance: Substance,
  temperatureC: number,
  cloud: 'primary' | 'secondary'
): number {
  return temperatureFactorInterpolation(substance, temperatureC, cloud).value;
}

export function k4Interpolation(windSpeedMps: number): InterpolationDetails {
  const wind = clamp(windSpeedMps, 1, 15);
  const speeds = K4_BY_WIND.map((row) => row.windMps);
  const [lowIndex, highIndex] = bracket(speeds, wind);
  const low = K4_BY_WIND[lowIndex];
  const high = K4_BY_WIND[highIndex];
  if (low === undefined || high === undefined) throw new Error('Повреждена таблица K4.');
  const value = interpolate(wind, low.windMps, high.windMps, low.k4, high.k4);
  const limited = wind !== windSpeedMps ? ` Скорость ${display(windSpeedMps)} м/с ограничена диапазоном таблицы до ${display(wind)} м/с.` : '';
  return { value, explanation: `${interpolationExplanation('K4', 'u', wind, low.windMps, high.windMps, low.k4, high.k4, value)}${limited}` };
}

export function interpolateK4(windSpeedMps: number): number {
  return k4Interpolation(windSpeedMps).value;
}

export function depthInterpolation(equivalentMassT: number, windSpeedMps: number): InterpolationDetails {
  if (equivalentMassT <= 0) return { value: 0, explanation: 'Эквивалентное количество равно нулю, поэтому глубина равна 0 км.' };
  const wind = clamp(windSpeedMps, 1, 15);
  const mass = clamp(equivalentMassT, EQUIVALENT_MASS_T[0], EQUIVALENT_MASS_T.at(-1) ?? 2000);
  const winds = Array.from({ length: 15 }, (_, index) => index + 1);
  const [windLowIndex, windHighIndex] = bracket(winds, wind);
  const [massLowIndex, massHighIndex] = bracket(EQUIVALENT_MASS_T, mass);
  const rowLow = DEPTH_KM[windLowIndex];
  const rowHigh = DEPTH_KM[windHighIndex];
  const massLow = EQUIVALENT_MASS_T[massLowIndex];
  const massHigh = EQUIVALENT_MASS_T[massHighIndex];
  const windLow = winds[windLowIndex];
  const windHigh = winds[windHighIndex];
  if (rowLow === undefined || rowHigh === undefined || massLow === undefined || massHigh === undefined || windLow === undefined || windHigh === undefined) throw new Error('Повреждена таблица глубин.');
  const lowMassValue = rowLow[massLowIndex] ?? 0;
  const highMassValue = rowLow[massHighIndex] ?? 0;
  const lowAtMass = interpolate(mass, massLow, massHigh, lowMassValue, highMassValue);
  const upperLowMassValue = rowHigh[massLowIndex] ?? 0;
  const upperHighMassValue = rowHigh[massHighIndex] ?? 0;
  const highAtMass = interpolate(mass, massLow, massHigh, upperLowMassValue, upperHighMassValue);
  const value = interpolate(wind, windLow, windHigh, lowAtMass, highAtMass);
  const massText = interpolationExplanation('Г(u₀)', 'Qэ', mass, massLow, massHigh, lowMassValue, highMassValue, lowAtMass);
  const secondMassText = windLow === windHigh ? '' : ` ${interpolationExplanation('Г(u₁)', 'Qэ', mass, massLow, massHigh, upperLowMassValue, upperHighMassValue, highAtMass)}`;
  const windText = ` ${interpolationExplanation('Г', 'u', wind, windLow, windHigh, lowAtMass, highAtMass, value)}`;
  const limits = `${mass !== equivalentMassT ? ` Qэ ограничено диапазоном таблицы до ${display(mass)} т.` : ''}${wind !== windSpeedMps ? ` u ограничена диапазоном таблицы до ${display(wind)} м/с.` : ''}`;
  return { value, explanation: `${massText}${secondMassText}${windText}${limits}` };
}

export function interpolateDepthKm(equivalentMassT: number, windSpeedMps: number): number {
  return depthInterpolation(equivalentMassT, windSpeedMps).value;
}

export function transferSpeedKmh(stability: Stability, windSpeedMps: number): number {
  const row = TRANSFER_SPEED_KMH[stability];
  if (stability !== 'isothermy' && windSpeedMps > row.length) {
    throw new Error(`Для устойчивости «${stability}» таблица переноса не содержит ветра ${windSpeedMps} м/с.`);
  }
  const wind = clamp(windSpeedMps, 1, row.length);
  const low = Math.floor(wind);
  const high = Math.ceil(wind);
  return interpolate(wind, low, high, row[low - 1] ?? 0, row[high - 1] ?? 0);
}

export function sectorAngleDegrees(windSpeedMps: number): number {
  if (windSpeedMps <= 0.5) return 360;
  if (windSpeedMps <= 1) return 180;
  if (windSpeedMps <= 2) return 90;
  return 45;
}
