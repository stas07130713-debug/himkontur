import type { GeoPoint } from '../core/types';

type LocalPoint = Readonly<{ x: number; y: number }>;
type Axis = 'u' | 'v';

const METERS_PER_LATITUDE_DEGREE = 111_320;
const MAX_ANGLE_ERROR_RADIANS = 12 * Math.PI / 180;

function dot(left: LocalPoint, right: LocalPoint): number {
  return left.x * right.x + left.y * right.y;
}

function signedArea(points: readonly LocalPoint[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return next === undefined ? sum : sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

/**
 * Straightens a confidently orthogonal closed contour. Ambiguous shapes are left
 * untouched so automatic correction cannot unexpectedly distort a building.
 */
export function alignOrthogonalContour(points: readonly GeoPoint[]): readonly GeoPoint[] | null {
  if (points.length < 4) return null;

  const latitudeOrigin = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitudeOrigin = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const metersPerLongitudeDegree = METERS_PER_LATITUDE_DEGREE * Math.cos(latitudeOrigin * Math.PI / 180);
  const local = points.map((point) => ({
    x: (point.longitude - longitudeOrigin) * metersPerLongitudeDegree,
    y: (point.latitude - latitudeOrigin) * METERS_PER_LATITUDE_DEGREE,
  }));
  const edges = local.map((point, index) => {
    const next = local[(index + 1) % local.length] as LocalPoint;
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    return { dx, dy, length: Math.hypot(dx, dy) };
  });
  if (edges.some((edge) => edge.length < 0.5)) return null;

  const longest = edges.reduce((best, edge) => edge.length > best.length ? edge : best);
  const u = { x: longest.dx / longest.length, y: longest.dy / longest.length };
  const v = { x: -u.y, y: u.x };
  const classified = edges.map((edge, index): Readonly<{ axis: Axis; constant: number }> | null => {
    const direction = { x: edge.dx / edge.length, y: edge.dy / edge.length };
    const alongU = Math.abs(dot(direction, u));
    const alongV = Math.abs(dot(direction, v));
    const alignment = Math.max(alongU, alongV);
    if (Math.acos(Math.min(1, alignment)) > MAX_ANGLE_ERROR_RADIANS) return null;
    const next = local[(index + 1) % local.length] as LocalPoint;
    if (alongU >= alongV) {
      return { axis: 'u', constant: (dot(local[index] as LocalPoint, v) + dot(next, v)) / 2 };
    }
    return { axis: 'v', constant: (dot(local[index] as LocalPoint, u) + dot(next, u)) / 2 };
  });
  if (classified.some((edge) => edge === null)) return null;
  const lines = classified as readonly Readonly<{ axis: Axis; constant: number }>[];
  if (lines.some((line, index) => line.axis === lines[(index + 1) % lines.length]?.axis)) return null;

  const aligned = lines.map((current, index): LocalPoint => {
    const previous = lines[(index - 1 + lines.length) % lines.length] as Readonly<{ axis: Axis; constant: number }>;
    const uCoordinate = previous.axis === 'v' ? previous.constant : current.constant;
    const vCoordinate = previous.axis === 'u' ? previous.constant : current.constant;
    return {
      x: u.x * uCoordinate + v.x * vCoordinate,
      y: u.y * uCoordinate + v.y * vCoordinate,
    };
  });

  const sortedLengths = edges.map((edge) => edge.length).sort((left, right) => left - right);
  const medianLength = sortedLengths[Math.floor(sortedLengths.length / 2)] ?? 0;
  const maximumShift = Math.max(1.5, Math.min(8, medianLength * 0.18));
  if (aligned.some((point, index) => Math.hypot(point.x - (local[index]?.x ?? point.x), point.y - (local[index]?.y ?? point.y)) > maximumShift)) return null;
  const originalArea = signedArea(local);
  const alignedArea = signedArea(aligned);
  if (Math.abs(alignedArea) < 1 || Math.sign(alignedArea) !== Math.sign(originalArea)) return null;

  return aligned.map((point) => ({
    latitude: latitudeOrigin + point.y / METERS_PER_LATITUDE_DEGREE,
    longitude: longitudeOrigin + point.x / metersPerLongitudeDegree,
  }));
}
