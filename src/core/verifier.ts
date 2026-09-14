import { hasCompleteTableV3Data, MISSING_TABLE_V3_DATA_MESSAGE, STABILITY_FACTOR, SUBSTANCES } from './reference-data';
import { nearlyEqual } from './math';
import {
  interpolateDepthKm,
  interpolateK4,
  interpolateTemperatureFactor,
  sectorAngleDegrees,
  transferSpeedKmh
} from './tables';
import type { CalculationResult, VerificationResult } from './types';

function compare(label: string, expected: number, actual: number, differences: string[]): void {
  if (!nearlyEqual(expected, actual, 1e-8)) {
    differences.push(`${label}: повторный расчет ${expected}, основной расчет ${actual}.`);
  }
}

export function verifyCalculation(result: CalculationResult, checkedAtIso: string): VerificationResult {
  const input = result.input;
  const substance = SUBSTANCES.find((item) => item.id === input.substanceId);
  const differences: string[] = [];
  if (substance === undefined || !hasCompleteTableV3Data(substance)) {
    return { status: 'failed', checkedAtIso, differences: [MISSING_TABLE_V3_DATA_MESSAGE] };
  }

  const k4 = interpolateK4(input.windSpeedMps);
  const k5 = STABILITY_FACTOR[input.stability];
  const k7Primary = interpolateTemperatureFactor(substance, input.temperatureC, 'primary');
  const k7Secondary = interpolateTemperatureFactor(substance, input.temperatureC, 'secondary');
  const height =
    input.spillKind === 'free'
      ? 0.05
      : input.spillKind === 'separateBund'
        ? input.bundHeightM - 0.2
        : input.massT / (input.commonBundAreaM2 * substance.densityLiquidTPerM3);
  const primary = substance.k1 * substance.k3 * k5 * k7Primary * input.massT;
  const evaporation = height * substance.densityLiquidTPerM3 / (substance.k2 * k4 * k7Secondary);
  const k6 = (evaporation < 1 ? 1 : Math.min(input.elapsedHours, evaporation)) ** 0.8;
  const secondary =
    ((1 - substance.k1) * substance.k2 * substance.k3 * k4 * k5 * k6 * k7Secondary * input.massT) /
    (height * substance.densityLiquidTPerM3);
  const primaryDepth = interpolateDepthKm(primary, input.windSpeedMps);
  const secondaryDepth = interpolateDepthKm(secondary, input.windSpeedMps);
  const combined = Math.max(primaryDepth, secondaryDepth) + 0.5 * Math.min(primaryDepth, secondaryDepth);
  const transferSpeed = transferSpeedKmh(input.stability, input.windSpeedMps);
  const transportLimit = input.elapsedHours * transferSpeed;
  const finalDepth = Math.min(combined, transportLimit, 20);
  const primaryAtForecast = Math.min(primaryDepth, transportLimit, 20);
  const secondaryAtForecast = Math.min(secondaryDepth, transportLimit, 20);
  const angle = sectorAngleDegrees(input.windSpeedMps);
  const area = 8.72e-3 * finalDepth ** 2 * angle;

  compare('Qэ1', primary, result.primaryEquivalentT, differences);
  compare('T', evaporation, result.evaporationHours, differences);
  compare('Qэ2', secondary, result.secondaryEquivalentT, differences);
  compare('Г1', primaryDepth, result.primaryDepthKm, differences);
  compare('Г2', secondaryDepth, result.secondaryDepthKm, differences);
  compare('Г', combined, result.combinedDepthKm, differences);
  compare('Гп', transportLimit, result.transportLimitKm, differences);
  compare('Гитог', finalDepth, result.finalDepthKm, differences);
  compare('Г1 на момент прогноза', primaryAtForecast, result.primaryDepthAtForecastKm, differences);
  compare('Г2 на момент прогноза', secondaryAtForecast, result.secondaryDepthAtForecastKm, differences);
  compare('Sв', area, result.possibleAreaKm2, differences);
  if (result.trace.length < 5) differences.push('Трасса расчета неполна.');

  const status = differences.length > 0 ? 'failed' : result.warnings.length > 0 ? 'warning' : 'verified';
  return { status, checkedAtIso, differences };
}
