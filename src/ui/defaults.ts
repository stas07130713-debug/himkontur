import type { CalculationInput, GeoPoint } from '../core/types';

export const MAP_BOUNDS = {
  west: 32.785263,
  south: 67.89858,
  east: 32.971001,
  north: 67.955323
} as const;

export const DEFAULT_POINT: GeoPoint = { longitude: 32.865336, latitude: 67.925279 };

export function currentMinuteIso(): string {
  const value = new Date();
  value.setSeconds(0, 0);
  return value.toISOString();
}

export const DEFAULT_INPUT: CalculationInput = {
  substanceId: 'chlorine',
  massT: 62.12,
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
  accidentTimeIso: currentMinuteIso(),
  sourcePoint: DEFAULT_POINT
};
