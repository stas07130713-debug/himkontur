import type { GeoPoint } from '../core/types';
import type { DistrictBuilding, DistrictMapObject } from './district-map-model';
import { buildingPrefix } from './district-map-model';

export const BUILDING_LAYER_KEYS = [
  'building-0',
  'building-1',
  'building-2',
  'building-3',
  'building-4',
  'building-5',
  'building-6',
  'building-7',
  'building-8',
  'building-9',
] as const;

export const NPPV_LAYER_KEYS = ['hydrant', 'reservoir'] as const;
export const SPECIAL_LAYER_KEYS = ['response-boundary', 'rescue-service'] as const;
export const DISTRICT_LAYER_KEYS = [...BUILDING_LAYER_KEYS, ...NPPV_LAYER_KEYS, ...SPECIAL_LAYER_KEYS] as const;
export type DistrictLayerKey = typeof DISTRICT_LAYER_KEYS[number];

export function districtLayerKey(object: DistrictMapObject): DistrictLayerKey {
  if (object.kind !== 'building') return object.kind;
  if (object.mapRole === 'response-boundary' || object.mapRole === 'rescue-service') return object.mapRole;
  const prefix = buildingPrefix(object.number);
  return `building-${/^[0-9]$/u.test(prefix) ? prefix : '1'}` as DistrictLayerKey;
}

export function hasDistrictMarker(object: DistrictMapObject): boolean {
  return object.kind !== 'building'
    || object.mapRole === 'rescue-service'
    || (object.objectType === 'building' && buildingPrefix(object.number) !== '0');
}

export function districtObjectFocusPoint(object: DistrictMapObject): GeoPoint {
  const minimumPoints = object.kind === 'building' && object.mapRole === 'response-boundary' ? 2 : 3;
  if (object.kind !== 'building' || object.contour.length < minimumPoints) return object.point;
  return {
    latitude: object.contour.reduce((sum, point) => sum + point.latitude, 0) / object.contour.length,
    longitude: object.contour.reduce((sum, point) => sum + point.longitude, 0) / object.contour.length,
  };
}

export function pointInsideDistrictContour(point: GeoPoint, contour: readonly GeoPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const currentPoint = contour[index];
    const previousPoint = contour[previous];
    if (currentPoint === undefined || previousPoint === undefined) continue;
    const crosses = (currentPoint.latitude > point.latitude) !== (previousPoint.latitude > point.latitude)
      && point.longitude < ((previousPoint.longitude - currentPoint.longitude) * (point.latitude - currentPoint.latitude))
        / (previousPoint.latitude - currentPoint.latitude) + currentPoint.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

function squaredDistanceToSegment(point: GeoPoint, start: GeoPoint, end: GeoPoint): number {
  const dx = end.longitude - start.longitude;
  const dy = end.latitude - start.latitude;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.longitude - start.longitude) * dx + (point.latitude - start.latitude) * dy) / lengthSquared,
  ));
  const x = start.longitude + ratio * dx;
  const y = start.latitude + ratio * dy;
  return (point.longitude - x) ** 2 + (point.latitude - y) ** 2;
}

/** Chooses a stable interior anchor, even when an old movable label was saved outside its building. */
export function districtObjectMarkerPoint(object: DistrictMapObject): GeoPoint {
  if (object.kind !== 'building' || object.contour.length < 3) return object.point;
  const contour = object.contour;
  // A label moved by the administrator keeps its exact position while it is
  // inside the contour. Only legacy/outside positions are repaired.
  if (pointInsideDistrictContour(object.point, contour)) return object.point;
  const latitudes = contour.map((point) => point.latitude);
  const longitudes = contour.map((point) => point.longitude);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const candidates: GeoPoint[] = [object.point, districtObjectFocusPoint(object)];
  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      candidates.push({
        latitude: south + (north - south) * row / 12,
        longitude: west + (east - west) * column / 12,
      });
    }
  }
  const inside = candidates.filter((point) => pointInsideDistrictContour(point, contour));
  if (inside.length === 0) return districtObjectFocusPoint(object);
  return inside.reduce((best, candidate) => {
    const clearance = contour.reduce((minimum, start, index) => {
      const end = contour[(index + 1) % contour.length] ?? start;
      return Math.min(minimum, squaredDistanceToSegment(candidate, start, end));
    }, Number.POSITIVE_INFINITY);
    const bestClearance = contour.reduce((minimum, start, index) => {
      const end = contour[(index + 1) % contour.length] ?? start;
      return Math.min(minimum, squaredDistanceToSegment(best, start, end));
    }, Number.POSITIVE_INFINITY);
    return clearance > bestClearance ? candidate : best;
  });
}

export function districtResponseBoundaryCenter(objects: readonly DistrictMapObject[]): GeoPoint | null {
  const points = objects
    .filter((object): object is DistrictBuilding => object.kind === 'building' && object.mapRole === 'response-boundary')
    .flatMap((object) => object.contour);
  if (points.length === 0) return null;
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };
}

export function fittedBuildingMarkerScale(
  object: DistrictMapObject,
  baseScale: number,
  project: (point: GeoPoint) => Readonly<{ x: number; y: number }>,
): number {
  if (object.kind !== 'building' || object.contour.length < 3) return baseScale;
  const polygon = object.contour.map(project);
  const center = project(districtObjectMarkerPoint(object));
  const pointInsidePolygon = (x: number, y: number): boolean => {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      if (currentPoint === undefined || previousPoint === undefined) continue;
      const crosses = (currentPoint.y > y) !== (previousPoint.y > y)
        && x < ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
      if (crosses) inside = !inside;
    }
    return inside;
  };
  const fits = (scale: number): boolean => {
    // Includes the white stroke around the 42 × 26 plate, so the visible plate
    // cannot cross even a rotated or concave building contour.
    const halfWidth = 22.5 * scale;
    const halfHeight = 14.5 * scale;
    return [
      { x: center.x - halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight },
      { x: center.x - halfWidth, y: center.y + halfHeight },
    ].every((corner) => pointInsidePolygon(corner.x, corner.y));
  };
  const upperBound = Math.min(baseScale, 1);
  if (upperBound <= 0 || !pointInsidePolygon(center.x, center.y)) return 0;
  if (fits(upperBound)) return upperBound;
  let lower = 0;
  let upper = upperBound;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const candidate = (lower + upper) / 2;
    if (fits(candidate)) lower = candidate; else upper = candidate;
  }
  return lower;
}

function buildingFootprint(object: DistrictBuilding): number {
  if (object.contour.length < 3) return 0;
  const latitudes = object.contour.map((point) => point.latitude);
  const longitudes = object.contour.map((point) => point.longitude);
  return (Math.max(...latitudes) - Math.min(...latitudes))
    * (Math.max(...longitudes) - Math.min(...longitudes));
}

export function twoTierBuildingMarkerScales(
  objects: readonly DistrictMapObject[],
  project: (point: GeoPoint) => Readonly<{ x: number; y: number }>,
): ReadonlyMap<string, number> {
  const buildings = objects.filter((object): object is DistrictBuilding => object.kind === 'building' && hasDistrictMarker(object));
  if (buildings.length === 0) return new Map();
  const footprints = buildings.map((object) => buildingFootprint(object)).sort((left, right) => left - right);
  const threshold = footprints[Math.floor((footprints.length - 1) / 3)] ?? 0;
  const smallScale = 0.58;
  const largeScale = 0.82;
  return new Map(buildings.flatMap((object) => {
    const fittedScale = fittedBuildingMarkerScale(object, Number.POSITIVE_INFINITY, project);
    const preferredScale = buildingFootprint(object) <= threshold ? smallScale : largeScale;
    if (fittedScale >= preferredScale) return [[object.id, preferredScale] as const];
    if (fittedScale >= smallScale) return [[object.id, smallScale] as const];
    // At a distant zoom the plate may become very small, but it remains visible
    // and never crosses the actual contour of its building.
    return fittedScale > 0 ? [[object.id, fittedScale] as const] : [];
  }));
}

export function isBuildingWithContour(object: DistrictMapObject): object is DistrictBuilding {
  return object.kind === 'building'
    && object.contour.length >= (object.mapRole === 'response-boundary' ? 2 : 3);
}
