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

export function isBuildingWithContour(object: DistrictMapObject): object is DistrictBuilding {
  return object.kind === 'building'
    && object.contour.length >= (object.mapRole === 'response-boundary' ? 2 : 3);
}
