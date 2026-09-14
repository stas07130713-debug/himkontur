import { EQUIVALENT_MASS_T, STABILITY_FACTOR } from './reference-data';
import { round } from './math';
import {
  depthInterpolation,
  interpolateDepthKm,
  k4Interpolation,
  sectorAngleDegrees,
  temperatureFactorInterpolation,
  transferSpeedKmh
} from './tables';
import type { CalculationInput, CalculationResult, Substance, TraceOperand, TraceStep } from './types';
import { validateInput } from './validation';

const MAX_DEPTH_KM = 20;
const STABILITY_LABELS = { inversion: 'инверсия', isothermy: 'изотермия', convection: 'конвекция' } as const;
const SPILL_LABELS = { free: 'свободный разлив', separateBund: 'отдельный поддон', commonBund: 'общий поддон' } as const;

function operand(symbol: string, value: number | string, unit: string, origin: string, calculation?: string): TraceOperand {
  return calculation === undefined ? { symbol, value, unit, origin } : { symbol, value, unit, origin, calculation };
}

function step(
  id: string,
  title: string,
  formula: string,
  substitution: string,
  result: number,
  unit: string,
  operands: readonly TraceOperand[]
): TraceStep {
  return { id, title, formula, substitution, result, unit, operands };
}

function layerHeightM(input: CalculationInput, substance: Substance): number {
  if (input.spillKind === 'free') return 0.05;
  if (input.spillKind === 'separateBund') return input.bundHeightM - 0.2;
  return input.massT / (input.commonBundAreaM2 * substance.densityLiquidTPerM3);
}

export function calculate(input: CalculationInput): CalculationResult {
  const substance = validateInput(input);
  const warnings: string[] = [];
  const trace: TraceStep[] = [];
  const k4Details = k4Interpolation(input.windSpeedMps);
  const k4 = k4Details.value;
  const k5 = STABILITY_FACTOR[input.stability];
  const k7PrimaryDetails = temperatureFactorInterpolation(substance, input.temperatureC, 'primary');
  const k7SecondaryDetails = temperatureFactorInterpolation(substance, input.temperatureC, 'secondary');
  const k7Primary = k7PrimaryDetails.value;
  const k7Secondary = k7SecondaryDetails.value;
  const heightM = layerHeightM(input, substance);

  if (input.windSpeedMps < 1 || input.windSpeedMps > 15) {
    warnings.push('Для таблиц глубины и K4 скорость ветра ограничена диапазоном 1-15 м/с.');
  }
  const minTemperature = substance.temperatureFactors[0]?.temperatureC ?? input.temperatureC;
  const maxTemperature = substance.temperatureFactors.at(-1)?.temperatureC ?? input.temperatureC;
  if (input.temperatureC < minTemperature || input.temperatureC > maxTemperature) {
    warnings.push(`Температурный коэффициент ограничен диапазоном ${minTemperature}…${maxTemperature} °C.`);
  }
  if (k7Secondary === 0) {
    warnings.push('При заданной температуре K7 вторичного облака равен нулю: испарение в рамках методики не рассчитывается.');
  }

  const primaryEquivalentT = substance.k1 * substance.k3 * k5 * k7Primary * input.massT;
  trace.push(step(
    'B-primary-equivalent',
    'Эквивалентное количество в первичном облаке',
    'Qэ1 = K1 × K3 × K5 × K7 × Q0',
    `${substance.k1} × ${substance.k3} × ${k5} × ${k7Primary} × ${input.massT}`,
    primaryEquivalentT,
    'т',
    [
      operand('K1', substance.k1, '', substance.source),
      operand('K3', substance.k3, '', substance.source),
      operand('K5', k5, '', `Устойчивость: ${STABILITY_LABELS[input.stability]}`),
      operand('K7', k7Primary, '', `${substance.source}; температура ${input.temperatureC} °C`, k7PrimaryDetails.explanation),
      operand('Q0', input.massT, 'т', 'Введено пользователем')
    ]
  ));

  const evaporationHours = heightM * substance.densityLiquidTPerM3 / (substance.k2 * k4 * k7Secondary);
  trace.push(step(
    'B-evaporation',
    'Продолжительность испарения',
    'T = h × d / (K2 × K4 × K7)',
    `${heightM} × ${substance.densityLiquidTPerM3} / (${substance.k2} × ${k4} × ${k7Secondary})`,
    evaporationHours,
    'ч',
    [
      operand('h', heightM, 'м', `Характер разлива: ${SPILL_LABELS[input.spillKind]}`),
      operand('d', substance.densityLiquidTPerM3, 'т/м³', substance.source),
      operand('K2', substance.k2, '', substance.source),
      operand('K4', k4, '', `Таблица В.4; ветер ${input.windSpeedMps} м/с`, k4Details.explanation),
      operand('K7', k7Secondary, '', `${substance.source}; температура ${input.temperatureC} °C`, k7SecondaryDetails.explanation)
    ]
  ));

  const k6Base = evaporationHours < 1 ? 1 : Math.min(input.elapsedHours, evaporationHours);
  const k6 = k6Base ** 0.8;
  const secondaryEquivalentT =
    ((1 - substance.k1) * substance.k2 * substance.k3 * k4 * k5 * k6 * k7Secondary * input.massT) /
    (heightM * substance.densityLiquidTPerM3);
  trace.push(step(
    'B-secondary-equivalent',
    'Эквивалентное количество во вторичном облаке',
    'Qэ2 = (1 − K1) × K2 × K3 × K4 × K5 × K6 × K7 × Q0 / (h × d)',
    `(1 − ${substance.k1}) × ${substance.k2} × ${substance.k3} × ${k4} × ${k5} × ${k6} × ${k7Secondary} × ${input.massT} / (${heightM} × ${substance.densityLiquidTPerM3})`,
    secondaryEquivalentT,
    'т',
    [
      operand('K1', substance.k1, '', substance.source),
      operand('K2', substance.k2, '', substance.source),
      operand('K3', substance.k3, '', substance.source),
      operand('K4', k4, '', `Таблица В.4; ветер ${input.windSpeedMps} м/с`, k4Details.explanation),
      operand('K5', k5, '', `Устойчивость: ${STABILITY_LABELS[input.stability]}`),
      operand('K6', k6, '', `N=${input.elapsedHours} ч; T=${round(evaporationHours)} ч`, `K6 = ${round(k6Base, 6)}⁰·⁸ = ${round(k6, 6)}.`),
      operand('K7', k7Secondary, '', `${substance.source}; температура ${input.temperatureC} °C`, k7SecondaryDetails.explanation),
      operand('Q0', input.massT, 'т', 'Введено пользователем'),
      operand('h', heightM, 'м', `Характер разлива: ${SPILL_LABELS[input.spillKind]}`),
      operand('d', substance.densityLiquidTPerM3, 'т/м³', substance.source)
    ]
  ));

  const primaryDepthDetails = depthInterpolation(primaryEquivalentT, input.windSpeedMps);
  const secondaryDepthDetails = depthInterpolation(secondaryEquivalentT, input.windSpeedMps);
  const primaryDepthKm = primaryDepthDetails.value;
  const secondaryDepthKm = secondaryDepthDetails.value;
  trace.push(step(
    'B-primary-depth',
    'Глубина зоны заражения первичным облаком Г1',
    'Г1 = интерполяция таблицы В.2 по Qэ1 и скорости ветра u',
    `Qэ1 = ${primaryEquivalentT} т; u = ${input.windSpeedMps} м/с`,
    primaryDepthKm,
    'км',
    [
      operand('Qэ1', primaryEquivalentT, 'т', 'Результат расчёта эквивалентного количества первичного облака'),
      operand('u', input.windSpeedMps, 'м/с', 'Исходные погодные данные'),
      operand('Г1', primaryDepthKm, 'км', 'СП 165.1325800.2014, приложение В, таблица В.2', primaryDepthDetails.explanation)
    ]
  ));
  trace.push(step(
    'B-secondary-depth',
    'Глубина зоны заражения вторичным облаком Г2',
    'Г2 = интерполяция таблицы В.2 по Qэ2 и скорости ветра u',
    `Qэ2 = ${secondaryEquivalentT} т; u = ${input.windSpeedMps} м/с`,
    secondaryDepthKm,
    'км',
    [
      operand('Qэ2', secondaryEquivalentT, 'т', 'Результат расчёта эквивалентного количества вторичного облака'),
      operand('u', input.windSpeedMps, 'м/с', 'Исходные погодные данные'),
      operand('Г2', secondaryDepthKm, 'км', 'СП 165.1325800.2014, приложение В, таблица В.2', secondaryDepthDetails.explanation)
    ]
  ));
  const largerDepth = Math.max(primaryDepthKm, secondaryDepthKm);
  const smallerDepth = Math.min(primaryDepthKm, secondaryDepthKm);
  const combinedDepthKm = largerDepth + 0.5 * smallerDepth;
  trace.push(step(
    'B-combined-depth',
    'Полная расчетная глубина',
    'Г = Г′ + 0,5 × Г″',
    `${largerDepth} + 0,5 × ${smallerDepth}`,
    combinedDepthKm,
    'км',
    [
      operand('Г′', largerDepth, 'км', 'Большее значение из таблицы В.2'),
      operand('Г″', smallerDepth, 'км', 'Меньшее значение из таблицы В.2')
    ]
  ));

  const transferSpeed = transferSpeedKmh(input.stability, input.windSpeedMps);
  const transportLimitKm = input.elapsedHours * transferSpeed;
  const finalDepthKm = Math.min(combinedDepthKm, transportLimitKm, MAX_DEPTH_KM);
  const potentialElapsedHours = Math.min(4, Math.max(input.elapsedHours, Math.min(evaporationHours, 4)));
  const potentialK6 = (evaporationHours < 1 ? 1 : Math.min(potentialElapsedHours, evaporationHours)) ** 0.8;
  const potentialSecondaryEquivalentT =
    ((1 - substance.k1) * substance.k2 * substance.k3 * k4 * k5 * potentialK6 * k7Secondary * input.massT) /
    (heightM * substance.densityLiquidTPerM3);
  const potentialSecondaryDepthKm = interpolateDepthKm(potentialSecondaryEquivalentT, input.windSpeedMps);
  const potentialCombinedDepthKm = Math.max(primaryDepthKm, potentialSecondaryDepthKm) + 0.5 * Math.min(primaryDepthKm, potentialSecondaryDepthKm);
  const potentialDepthKm = Math.min(potentialCombinedDepthKm, potentialElapsedHours * transferSpeed, MAX_DEPTH_KM);
  const primaryDepthAtForecastKm = Math.min(primaryDepthKm, transportLimitKm, MAX_DEPTH_KM);
  const secondaryDepthAtForecastKm = Math.min(secondaryDepthKm, transportLimitKm, MAX_DEPTH_KM);
  trace.push(step(
    'B-final-depth',
    'Окончательная глубина',
    'Гитог = min(Г, N × V, 20 км)',
    `min(${combinedDepthKm}, ${input.elapsedHours} × ${transferSpeed}, ${MAX_DEPTH_KM})`,
    finalDepthKm,
    'км',
    [
      operand('Г', combinedDepthKm, 'км', 'Результат объединения облаков'),
      operand('N', input.elapsedHours, 'ч', 'Время прогноза'),
      operand('V', transferSpeed, 'км/ч', `Таблица В.5; устойчивость ${input.stability}`),
      operand('Гmax', MAX_DEPTH_KM, 'км', 'Нормативное ограничение пилотной методики')
    ]
  ));

  const sectorAngle = sectorAngleDegrees(input.windSpeedMps);
  const possibleAreaKm2 = 8.72e-3 * finalDepthKm ** 2 * sectorAngle;
  trace.push(step(
    'B-possible-area',
    'Площадь зоны возможного заражения',
    'S = 8,72 × 10⁻³ × Г² × φ',
    `0,00872 × ${finalDepthKm}² × ${sectorAngle}`,
    possibleAreaKm2,
    'км²',
    [
      operand('Г', finalDepthKm, 'км', 'Окончательная глубина'),
      operand('φ', sectorAngle, '°', `Таблица углов; ветер ${input.windSpeedMps} м/с`)
    ]
  ));
  for (const mass of [primaryEquivalentT, secondaryEquivalentT]) {
    if (mass > 0 && (mass < EQUIVALENT_MASS_T[0] || mass > (EQUIVALENT_MASS_T.at(-1) ?? 2000))) {
      warnings.push('Эквивалентная масса вышла за границы таблицы глубин и была ограничена краевым значением.');
      break;
    }
  }

  return {
    input,
    substance,
    primaryEquivalentT,
    secondaryEquivalentT,
    evaporationHours,
    primaryDepthKm,
    secondaryDepthKm,
    primaryDepthAtForecastKm,
    secondaryDepthAtForecastKm,
    combinedDepthKm,
    transportLimitKm,
    finalDepthKm,
    potentialDepthKm,
    possibleAreaKm2,
    transferSpeedKmh: transferSpeed,
    sectorAngleDegrees: sectorAngle,
    plumeToDegrees: (input.windFromDegrees + 180) % 360,
    warnings,
    trace
  };
}
