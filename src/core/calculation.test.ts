import { describe, expect, it } from 'vitest';
import { calculate } from './calculation';
import { DEPTH_KM, EQUIVALENT_MASS_T, hasCompleteTableV3Data, MISSING_TABLE_V3_DATA_MESSAGE, SUBSTANCES } from './reference-data';
import { verifyCalculation } from './verifier';
import type { CalculationInput } from './types';
import { CAPACITY_MASS_COEFFICIENT, CHLORINE_DENSITY_T_PER_M3, formatCalculatedQuantity, massFromCapacity, massFromSource, pipelineVolumeM3, SOURCE_LIBRARY } from '../ui/source-library';

const INPUT: CalculationInput = {
  substanceId: 'chlorine',
  massT: 40,
  spillKind: 'free',
  bundHeightM: 1,
  commonBundAreaM2: 100,
  temperatureC: 0,
  windSpeedMps: 5,
  windFromDegrees: 270,
  cloudCoverPercent: 100,
  snowCover: false,
  stability: 'isothermy',
  elapsedHours: 1,
  accidentTimeIso: '2026-09-08T12:00:00.000Z',
  sourcePoint: { latitude: 67.925279, longitude: 32.865336 }
};

describe('calculation core', () => {
  it('calculates the traceable chlorine scenario from normative coefficients', () => {
    const result = calculate(INPUT);
    expect(result.primaryEquivalentT).toBeCloseTo(0.9936, 8);
    expect(result.evaporationHours).toBeCloseTo(0.638149, 5);
    expect(result.secondaryEquivalentT).toBeCloseTo(11.82173, 4);
    expect(result.finalDepthKm).toBeCloseTo(6.85143, 4);
    expect(result.possibleAreaKm2).toBeCloseTo(18.4201, 3);
    expect(result.trace).toHaveLength(8);
    expect(result.trace.some((step) => step.id === 'B-primary-depth')).toBe(true);
    expect(result.trace.some((step) => step.id === 'B-secondary-depth')).toBe(true);
    expect(result.trace.flatMap((step) => step.operands).some((item) => item.symbol === 'K7' && item.calculation !== undefined)).toBe(true);
    expect('actualAreaKm2' in result).toBe(false);
  });

  it('records the full interpolation of a calculated K7 coefficient', () => {
    const result = calculate({ ...INPUT, temperatureC: 13 });
    expect(result.trace.flatMap((step) => step.operands).some((item) => item.symbol === 'K7' && item.calculation?.includes('Линейная интерполяция'))).toBe(true);
  });

  it('uses the permanent vessel conversion coefficient instead of a fill percentage', () => {
    expect(CAPACITY_MASS_COEFFICIENT).toBe(1.25);
    expect(massFromCapacity(50, 1.553)).toBeCloseTo(62.12, 10);
  });

  it('calculates and displays a small non-zero pipeline volume and mass', () => {
    const volumeM3 = pipelineVolumeM3(3, 50);
    const massT = massFromSource({
      id: 'acrolein-pipeline', kind: 'process', label: 'Акролеин — трубопровод', substanceId: 'acrolein',
      volumeM3, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100,
      calculationMode: 'pipeline', conversionTPerM3: 0.84, pipelineLengthM: 3, pipelineDiameterMm: 50
    }, 0.84);
    expect(volumeM3).toBeCloseTo(0.005890486, 8);
    expect(massT).toBeCloseTo(0.004948008, 8);
    expect(formatCalculatedQuantity(volumeM3)).toBe('0,00589');
    expect(formatCalculatedQuantity(massT)).toBe('0,00495');
  });

  it('uses the table V.3 liquid density as the default volume-to-mass coefficient for every substance', () => {
    for (const substance of SUBSTANCES) {
      const massT = massFromSource({
        id: `test-${substance.id}`, kind: 'process', label: substance.name, substanceId: substance.id,
        volumeM3: 1, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100,
        calculationMode: 'pipeline', conversionTPerM3: substance.densityLiquidTPerM3,
        pipelineLengthM: 1, pipelineDiameterMm: 1128.379
      }, substance.densityLiquidTPerM3);
      expect(massT).toBe(substance.densityLiquidTPerM3);
    }
  });

  it('preserves the approved standard chlorine source capacities', () => {
    const source = (id: string) => SOURCE_LIBRARY.find((item) => item.id === id)?.volumeM3 ?? -1;
    expect(massFromCapacity(source('rail'), CHLORINE_DENSITY_T_PER_M3)).toBeCloseTo(54, 10);
    expect(source('tank')).toBe(40);
    expect(massFromCapacity(source('rail-tanks'), CHLORINE_DENSITY_T_PER_M3)).toBeCloseTo(52, 10);
    expect(source('cylinder')).toBe(0.06);
    expect(source('truck')).toBe(0);
    expect(source('process')).toBe(0);
  });

  it('recalculates the supplied 50 t chlorine case without the unsupported K7 value', () => {
    const result = calculate({
      ...INPUT,
      massT: 50,
      temperatureC: 10,
      windSpeedMps: 4,
      windFromDegrees: 0,
      elapsedHours: 0.16
    });
    expect(result.primaryEquivalentT).toBeCloseTo(1.656, 10);
    expect(result.secondaryEquivalentT).toBeCloseTo(12.6300064392, 8);
    expect(result.primaryDepthKm).toBeCloseTo(2.3392, 8);
    expect(result.combinedDepthKm).toBeCloseTo(8.4606820348, 8);
    expect(result.transportLimitKm).toBeCloseTo(3.84, 10);
    expect(result.finalDepthKm).toBeCloseTo(3.84, 10);
    expect(result.possibleAreaKm2).toBeCloseTo(5.78617344, 8);
    expect(result.plumeToDegrees).toBe(180);
  });

  it('contains every mass column and the audited cells from table V.2', () => {
    expect(EQUIVALENT_MASS_T).toEqual([
      0.01, 0.05, 0.1, 0.5, 1, 3, 5, 10, 20, 30, 50, 70, 100, 300, 500, 700, 1000, 2000
    ]);
    expect(DEPTH_KM).toHaveLength(15);
    expect(DEPTH_KM.every((row) => row.length === EQUIVALENT_MASS_T.length)).toBe(true);
    expect(DEPTH_KM[3]?.[10]).toBe(16.43);
    expect(DEPTH_KM[0]?.[17]).toBe(572);
    expect(DEPTH_KM[14]?.[17]).toBe(52.37);
  });

  it('supports a fractional elapsed time used by the methodology examples', () => {
    const result = calculate({ ...INPUT, elapsedHours: 0.5 });
    expect(result.finalDepthKm).toBeGreaterThan(0);
    expect(result.transportLimitKm).toBe(14.5);
  });

  it('does not display component clouds beyond the front reached at the forecast moment', () => {
    const result = calculate({
      ...INPUT,
      massT: 62.12,
      temperatureC: 13.4,
      windSpeedMps: 4.1,
      elapsedHours: 2 / 60
    });
    expect(result.primaryDepthKm).toBeGreaterThan(result.finalDepthKm);
    expect(result.secondaryDepthKm).toBeGreaterThan(result.finalDepthKm);
    expect(result.finalDepthKm).toBeCloseTo(result.transportLimitKm, 10);
    expect(result.primaryDepthAtForecastKm).toBeCloseTo(result.transportLimitKm, 10);
    expect(result.secondaryDepthAtForecastKm).toBeCloseTo(result.transportLimitKm, 10);
    expect(verifyCalculation(result, '2026-09-10T15:00:00.000Z').status).toBe('verified');
  });

  it('follows the normative wind tables: the front accelerates while tabular depth can decrease', () => {
    const atFive = calculate({ ...INPUT, windSpeedMps: 5 });
    const atTen = calculate({ ...INPUT, windSpeedMps: 10 });
    expect(atTen.transferSpeedKmh).toBeGreaterThan(atFive.transferSpeedKmh);
    expect(atTen.finalDepthKm).toBeLessThan(atFive.finalDepthKm);
  });

  it('uses the 15 m/s boundary values when wind exceeds the depth-table range', () => {
    const atFifteen = calculate({ ...INPUT, windSpeedMps: 15 });
    const aboveRange = calculate({ ...INPUT, windSpeedMps: 20 });
    expect(aboveRange.finalDepthKm).toBeCloseTo(atFifteen.finalDepthKm, 10);
    expect(aboveRange.warnings).toContain('Для таблиц глубины и K4 скорость ветра ограничена диапазоном 1-15 м/с.');
  });

  it('independently verifies and detects tampering', () => {
    const result = calculate(INPUT);
    expect(verifyCalculation(result, '2026-09-08T13:00:00.000Z').status).toBe('verified');
    const changed = { ...result, finalDepthKm: result.finalDepthKm + 1 };
    expect(verifyCalculation(changed, '2026-09-08T13:00:00.000Z').status).toBe('failed');
  });

  it('contains only complete and uniquely mapped table V.3 rows', () => {
    expect(SUBSTANCES).toHaveLength(35);
    expect(new Set(SUBSTANCES.map((item) => item.id)).size).toBe(SUBSTANCES.length);
    expect(new Set(SUBSTANCES.map((item) => item.tableV3Row)).size).toBe(SUBSTANCES.length);
    expect(SUBSTANCES.every(hasCompleteTableV3Data)).toBe(true);
    expect(SUBSTANCES.some((item) => item.name === 'Серная кислота')).toBe(false);
    expect(SUBSTANCES.filter((item) => item.name.startsWith('Аммиак'))).toHaveLength(2);
    const chlorine = SUBSTANCES.find((item) => item.id === 'chlorine');
    if (chlorine === undefined) throw new Error('Строка хлора отсутствует.');
    expect(hasCompleteTableV3Data({ ...chlorine, k2: Number.NaN })).toBe(false);
  });

  it('successfully performs and verifies a test calculation for every table V.3 row', () => {
    for (const substance of SUBSTANCES) {
      const result = calculate({ ...INPUT, substanceId: substance.id, temperatureC: 20 });
      expect(Number.isFinite(result.finalDepthKm), substance.name).toBe(true);
      expect(Number.isFinite(result.primaryEquivalentT), substance.name).toBe(true);
      expect(Number.isFinite(result.secondaryEquivalentT), substance.name).toBe(true);
      expect(verifyCalculation(result, '2026-09-10T15:00:00.000Z').status, substance.name).not.toBe('failed');
    }
  });

  it('uses the required system message for an absent normative row', () => {
    expect(() => calculate({ ...INPUT, substanceId: 'sulfuric-acid' })).toThrow(MISSING_TABLE_V3_DATA_MESSAGE);
  });
});
