import { describe, expect, it } from 'vitest';
import { assessStability } from './stability';
import type { CalculationInput } from './types';

const input: CalculationInput = {
  substanceId: 'chlorine', massT: 40, spillKind: 'free', bundHeightM: 1, commonBundAreaM2: 100,
  temperatureC: 0, windSpeedMps: 5, windFromDegrees: 0, cloudCoverPercent: 0, snowCover: false,
  stability: 'inversion', elapsedHours: 1, accidentTimeIso: '2026-09-10T12:00:00.000Z',
  sourcePoint: { latitude: 67.925279, longitude: 32.865336 }
};

describe('automatic atmospheric stability', () => {
  it('selects isothermy for wind at least 4 m/s regardless of other inputs', () => {
    expect(assessStability(input).stability).toBe('isothermy');
  });

  it('selects isothermy for solid cloud cover', () => {
    expect(assessStability({ ...input, windSpeedMps: 1, cloudCoverPercent: 100 }).stability).toBe('isothermy');
  });
});
