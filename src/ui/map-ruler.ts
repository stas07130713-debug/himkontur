import type { GeoPoint } from '../core/types';

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(first: GeoPoint, second: GeoPoint): number {
  const radians = Math.PI / 180;
  const latitude1 = first.latitude * radians;
  const latitude2 = second.latitude * radians;
  const deltaLatitude = (second.latitude - first.latitude) * radians;
  const deltaLongitude = (second.longitude - first.longitude) * radians;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function formatRulerDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} м`;
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 2 : 1)} км`;
}

export function cumulativeDistanceMeters(points: readonly GeoPoint[], endIndex = points.length - 1): number {
  let distance = 0;
  for (let index = 1; index <= endIndex; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) distance += distanceMeters(previous, current);
  }
  return distance;
}
