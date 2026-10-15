import { describe, expect, it } from 'vitest';
import { cumulativeDistanceMeters, distanceMeters, formatRulerDistance } from './map-ruler';

describe('линейка карты', () => {
  it('измеряет каждый участок и суммирует ломаную', () => {
    const points = [
      { latitude: 67.925, longitude: 32.865 },
      { latitude: 67.926, longitude: 32.865 },
      { latitude: 67.926, longitude: 32.867 },
    ] as const;
    const [start, middle, end] = points;
    const first = distanceMeters(start, middle);
    const second = distanceMeters(middle, end);
    expect(first).toBeGreaterThan(110);
    expect(first).toBeLessThan(112);
    expect(cumulativeDistanceMeters(points)).toBeCloseTo(first + second, 6);
  });

  it('показывает метры и километры в понятном формате', () => {
    expect(formatRulerDistance(148.7)).toBe('149 м');
    expect(formatRulerDistance(1_250)).toBe('1.25 км');
  });
});
