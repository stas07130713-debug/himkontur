import { describe, expect, it } from 'vitest';
import type { DistrictBuilding, DistrictHydrant } from './district-map-model';
import { districtLayerKey, districtObjectFocusPoint, fittedBuildingMarkerScale, hasDistrictMarker, isBuildingWithContour } from './district-map-visuals';

const building: DistrictBuilding = {
  id: 'building-1',
  kind: 'building',
  objectType: 'building',
  number: '4.12',
  point: { latitude: 10, longitude: 10 },
  contour: [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 4 },
    { latitude: 2, longitude: 4 },
    { latitude: 2, longitude: 0 },
  ],
  territoryNames: [],
  inventoryNumber: '',
  planningDocuments: [],
  workshopFull: 'Химико-металлургический цех',
  workshopShort: 'ХМЦ',
  departments: [],
  sites: [],
  note: '',
  updatedAtIso: '2026-10-17T00:00:00.000Z',
};

const hydrant: DistrictHydrant = {
  id: 'hydrant-1', kind: 'hydrant', point: { latitude: 0, longitude: 0 }, number: 'ПГ-1', owner: '',
  status: 'unknown', faultDescription: '', network: 'ring', hydrantType: 'standard', pattern: 'moscow',
  diameterMm: null, pressureAtm: null, heightMm: null, signDistanceLeftM: null, signDistanceRightM: null,
  signDistanceForwardM: null, lastInspectionDate: '', note: '', updatedAtIso: '2026-10-17T00:00:00.000Z',
};

describe('district map visual helpers', () => {
  it('maps buildings and NPPV objects to independent layers', () => {
    expect(districtLayerKey(building)).toBe('building-4');
    expect(districtLayerKey(hydrant)).toBe('hydrant');
  });

  it('focuses a contoured building by the contour center instead of its movable label', () => {
    expect(districtObjectFocusPoint(building)).toEqual({ latitude: 1, longitude: 2 });
  });

  it('shrinks a building plate to stay inside a small contour', () => {
    const scale = fittedBuildingMarkerScale(building, 1, (point) => ({ x: point.longitude * 5, y: point.latitude * 5 }));
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.08);
  });

  it('keeps territory numbers in data without drawing a territory plate', () => {
    const territory: DistrictBuilding = { ...building, objectType: 'territory', number: '0.1' };
    expect(hasDistrictMarker(territory)).toBe(false);
    expect(hasDistrictMarker({ ...building, objectType: 'building', number: '0.2' })).toBe(false);
    expect(hasDistrictMarker(building)).toBe(true);
  });

  it('maps the response boundary and rescue service to independent switchable layers', () => {
    expect(districtLayerKey({ ...building, mapRole: 'response-boundary' })).toBe('response-boundary');
    expect(districtLayerKey({ ...building, mapRole: 'rescue-service' })).toBe('rescue-service');
  });

  it('treats a two-point response boundary as an open line, not as a polygon', () => {
    const boundary: DistrictBuilding = {
      ...building,
      objectType: 'territory',
      mapRole: 'response-boundary',
      contour: building.contour.slice(0, 2),
    };
    expect(isBuildingWithContour(boundary)).toBe(true);
    expect(districtObjectFocusPoint(boundary)).toEqual({ latitude: 0, longitude: 2 });
    expect(isBuildingWithContour({ ...boundary, mapRole: 'ordinary' })).toBe(false);
  });
});
