import { describe, expect, it } from 'vitest';
import { calculate } from './calculation';
import { verifyCalculation } from './verifier';
import type { CalculationInput, SpillKind } from './types';

const BASE: CalculationInput = {
  substanceId: 'chlorine', massT: 40, spillKind: 'free', bundHeightM: 1,
  commonBundAreaM2: 100, temperatureC: 0, windSpeedMps: 5,
  windFromDegrees: 0, cloudCoverPercent: 100, snowCover: false, stability: 'isothermy', elapsedHours: 1,
  accidentTimeIso: '2026-09-10T10:00:00.000Z',
  sourcePoint: { latitude: 67.925279, longitude: 32.865336 }
};

describe('calculation robustness', () => {
  it('stays finite and independently verifiable across boundary inputs', () => {
    const spillKinds: readonly SpillKind[] = ['free', 'separateBund', 'commonBund'];
    for (const substanceId of ['chlorine', 'hydrochloric-acid']) {
      for (const windSpeedMps of [0.1, 1, 1.5, 4, 5, 15, 20]) {
        for (const temperatureC of [-40, 0, 20, 40]) {
          for (const spillKind of spillKinds) {
            const result = calculate({ ...BASE, substanceId, windSpeedMps, temperatureC, spillKind });
            expect(Number.isFinite(result.finalDepthKm)).toBe(true);
            expect(Number.isFinite(result.possibleAreaKm2)).toBe(true);
            expect(result.finalDepthKm).toBeGreaterThanOrEqual(0);
            expect(result.finalDepthKm).toBeLessThanOrEqual(20);
            const verification = verifyCalculation(result, BASE.accidentTimeIso);
            expect(
              verification.status,
              JSON.stringify({ substanceId, windSpeedMps, temperatureC, spillKind, differences: verification.differences })
            ).not.toBe('failed');
          }
        }
      }
    }
  });

  it('converts meteorological wind direction to downwind plume direction', () => {
    expect(calculate({ ...BASE, windFromDegrees: 0 }).plumeToDegrees).toBe(180);
    expect(calculate({ ...BASE, windFromDegrees: 90 }).plumeToDegrees).toBe(270);
    expect(calculate({ ...BASE, windFromDegrees: 180 }).plumeToDegrees).toBe(0);
    expect(calculate({ ...BASE, windFromDegrees: 270 }).plumeToDegrees).toBe(90);
  });
});
