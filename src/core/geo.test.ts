import { describe, expect, it } from 'vitest';
import { calculate } from './calculation';
import { distanceKm, evaluateControlPoint } from './geo';
import type { CalculationInput } from './types';

const SOURCE = { latitude: 67.925279, longitude: 32.865336 };

describe('geodesic control points', () => {
  it('measures geographic distance independently of map zoom', () => {
    expect(distanceKm(SOURCE, { latitude: SOURCE.latitude + 0.008993, longitude: SOURCE.longitude })).toBeCloseTo(1, 2);
  });

  it('returns elapsed and clock arrival time inside the plume sector', () => {
    const input: CalculationInput = {
      substanceId: 'chlorine', massT: 40, spillKind: 'free', bundHeightM: 1,
      commonBundAreaM2: 100, temperatureC: 0, windSpeedMps: 1,
      windFromDegrees: 0, cloudCoverPercent: 0, snowCover: false, stability: 'inversion', elapsedHours: 1,
      accidentTimeIso: '2026-09-08T12:00:00.000Z', sourcePoint: SOURCE
    };
    const point = { latitude: SOURCE.latitude - 0.008993, longitude: SOURCE.longitude };
    const evaluated = evaluateControlPoint(calculate(input), point);
    expect(evaluated.insideSector).toBe(true);
    expect(evaluated.arrivalHours).toBeCloseTo(0.2, 2);
    expect(evaluated.arrivalMinutesAfterAccident).toBe(12);
    expect(Date.parse(evaluated.arrivalTimeIso ?? '')).toBeCloseTo(Date.parse('2026-09-08T12:12:00.000Z'), -2);
  });

  it('moves a plume eastward when the wind is western', () => {
    const input: CalculationInput = {
      substanceId: 'chlorine', massT: 40, spillKind: 'free', bundHeightM: 1,
      commonBundAreaM2: 100, temperatureC: 0, windSpeedMps: 5,
      windFromDegrees: 270, cloudCoverPercent: 100, snowCover: false, stability: 'isothermy', elapsedHours: 1,
      accidentTimeIso: '2026-09-08T12:00:00.000Z', sourcePoint: SOURCE
    };
    const result = calculate(input);
    const longitudeDegreePerKm = 1 / (111.32 * Math.cos(SOURCE.latitude * Math.PI / 180));
    const east = evaluateControlPoint(result, { ...SOURCE, longitude: SOURCE.longitude + longitudeDegreePerKm });
    const west = evaluateControlPoint(result, { ...SOURCE, longitude: SOURCE.longitude - longitudeDegreePerKm });
    expect(result.plumeToDegrees).toBe(90);
    expect(east.insideSector).toBe(true);
    expect(west.insideSector).toBe(false);
  });

  it('marks a downwind point as future-affected when it is beyond the selected forecast moment', () => {
    const input: CalculationInput = {
      substanceId: 'chlorine', massT: 40, spillKind: 'free', bundHeightM: 1,
      commonBundAreaM2: 100, temperatureC: 0, windSpeedMps: 1,
      windFromDegrees: 0, cloudCoverPercent: 0, snowCover: false, stability: 'inversion', elapsedHours: 0.1,
      accidentTimeIso: '2026-09-08T12:00:00.000Z', sourcePoint: SOURCE
    };
    const point = { latitude: SOURCE.latitude - 0.008993, longitude: SOURCE.longitude };
    const evaluated = evaluateControlPoint(calculate(input), point);
    expect(evaluated.reachedByForecast).toBe(false);
    expect(evaluated.willBeAffected).toBe(true);
    expect(evaluated.arrivalHours).toBeCloseTo(0.2, 2);
  });

  it('uses one conservative whole-minute boundary for both the relative and clock arrival labels', () => {
    const base: CalculationInput = {
      substanceId: 'chlorine', massT: 40, spillKind: 'free', bundHeightM: 1,
      commonBundAreaM2: 100, temperatureC: 0, windSpeedMps: 1.83,
      windFromDegrees: 0, cloudCoverPercent: 100, snowCover: false, stability: 'isothermy', elapsedHours: 2 / 60,
      accidentTimeIso: '2026-09-12T13:19:00.000Z', sourcePoint: SOURCE
    };
    const speed = calculate(base).transferSpeedKmh;
    const distance = speed * 2.4 / 60;
    const point = { latitude: SOURCE.latitude - distance / 111.32, longitude: SOURCE.longitude };
    const before = evaluateControlPoint(calculate(base), point);
    const atDisplayedMinute = evaluateControlPoint(calculate({ ...base, elapsedHours: 3 / 60 }), point);
    expect(before.reachedByForecast).toBe(false);
    expect(before.arrivalMinutesAfterAccident).toBe(3);
    expect(before.arrivalTimeIso).toBe('2026-09-12T13:22:00.000Z');
    expect(atDisplayedMinute.reachedByForecast).toBe(true);
  });

  it('does not promise arrival before the full method grows the cloud to the control point', () => {
    const input: CalculationInput = {
      substanceId: 'acetonitrile', massT: 31.44, spillKind: 'free', bundHeightM: 1,
      commonBundAreaM2: 100, temperatureC: 10.26, windSpeedMps: 1.83,
      windFromDegrees: 341.37, cloudCoverPercent: 100, snowCover: false, stability: 'isothermy', elapsedHours: 2 / 60,
      accidentTimeIso: '2026-09-12T13:19:00.000Z', sourcePoint: SOURCE
    };
    const bearing = (input.windFromDegrees + 180) % 360 * Math.PI / 180;
    const distance = 0.53;
    const point = {
      latitude: SOURCE.latitude + Math.cos(bearing) * distance / 111.32,
      longitude: SOURCE.longitude + Math.sin(bearing) * distance / (111.32 * Math.cos(SOURCE.latitude * Math.PI / 180))
    };
    const evaluated = evaluateControlPoint(calculate(input), point);
    expect(evaluated.reachedByForecast).toBe(false);
    expect(evaluated.willBeAffected).toBe(true);
    expect(evaluated.arrivalMinutesAfterAccident).not.toBeNull();
    const arrivalMinute = evaluated.arrivalMinutesAfterAccident ?? 0;
    expect(arrivalMinute).toBeGreaterThan(Math.ceil(distance / calculate(input).transferSpeedKmh * 60));
    expect(evaluateControlPoint(calculate({ ...input, elapsedHours: (arrivalMinute - 1) / 60 }), point).reachedByForecast).toBe(false);
    expect(evaluateControlPoint(calculate({ ...input, elapsedHours: arrivalMinute / 60 }), point).reachedByForecast).toBe(true);
    expect(evaluated.arrivalTimeIso).toBe(new Date(Date.parse(input.accidentTimeIso) + arrivalMinute * 60_000).toISOString());
  });
});
