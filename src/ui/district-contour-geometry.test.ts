import { describe, expect, it } from 'vitest';
import type { GeoPoint } from '../core/types';
import { alignOrthogonalContour } from './district-contour-geometry';

function vector(left: GeoPoint, right: GeoPoint) {
  return { x: right.longitude - left.longitude, y: right.latitude - left.latitude };
}

describe('orthogonal contour alignment', () => {
  it('straightens a near-rectangular building and equalizes opposite sides', () => {
    const input: readonly GeoPoint[] = [
      { latitude: 67.920000, longitude: 32.840000 },
      { latitude: 67.920012, longitude: 32.841000 },
      { latitude: 67.920410, longitude: 32.841018 },
      { latitude: 67.920400, longitude: 32.839990 },
    ];
    const result = alignOrthogonalContour(input);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected a straightened contour');
    const edges = result.map((point, index) => {
      const next = result[(index + 1) % result.length];
      if (next === undefined) throw new Error('Expected a closed contour');
      return vector(point, next);
    });
    const [first, second, third, fourth] = edges;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined) throw new Error('Expected four edges');
    const cross = (left: ReturnType<typeof vector>, right: ReturnType<typeof vector>) => left.x * right.y - left.y * right.x;
    expect(Math.abs(cross(first, third))).toBeLessThan(1e-12);
    expect(Math.abs(cross(second, fourth))).toBeLessThan(1e-12);
  });

  it('does not change an uncertain non-orthogonal shape', () => {
    expect(alignOrthogonalContour([
      { latitude: 67.92, longitude: 32.84 },
      { latitude: 67.9204, longitude: 32.8408 },
      { latitude: 67.9208, longitude: 32.8402 },
      { latitude: 67.9204, longitude: 32.8397 },
    ])).toBeNull();
  });
});
