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
    || (object.objectType !== 'territory' && buildingPrefix(object.number) !== '0');
}

export function districtObjectFocusPoint(object: DistrictMapObject): GeoPoint {
  const minimumPoints = object.kind === 'building' && object.mapRole === 'response-boundary' ? 2 : 3;
  if (object.kind !== 'building' || object.contour.length < minimumPoints) return object.point;
  return {
    latitude: object.contour.reduce((sum, point) => sum + point.latitude, 0) / object.contour.length,
    longitude: object.contour.reduce((sum, point) => sum + point.longitude, 0) / object.contour.length,
  };
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
  const points = object.contour.map(project);
  const width = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
  const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
  const fitted = Math.min((width * 0.72) / 42, (height * 0.72) / 26, 1);
  return Math.min(baseScale, Math.max(0.08, fitted));
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
  baseScale: number,
): ReadonlyMap<string, number> {
  const buildings = objects.filter((object): object is DistrictBuilding => object.kind === 'building' && hasDistrictMarker(object));
  if (buildings.length === 0) return new Map();
  const footprints = buildings.map((object) => buildingFootprint(object)).sort((left, right) => left - right);
  const threshold = footprints[Math.floor((footprints.length - 1) / 3)] ?? 0;
  const smallScale = Math.max(0.28, baseScale * 0.72);
  const largeScale = Math.max(0.42, baseScale);
  return new Map(buildings.map((object) => [
    object.id,
    buildingFootprint(object) <= threshold ? smallScale : largeScale,
  ]));
}

export function isBuildingWithContour(object: DistrictMapObject): object is DistrictBuilding {
  return object.kind === 'building'
    && object.contour.length >= (object.mapRole === 'response-boundary' ? 2 : 3);
}
