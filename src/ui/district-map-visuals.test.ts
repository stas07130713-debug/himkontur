import { describe, expect, it } from 'vitest';
import type { DistrictBuilding, DistrictHydrant } from './district-map-model';
import { districtLayerKey, districtObjectFocusPoint, districtObjectMarkerPoint, districtResponseBoundaryCenter, fittedBuildingMarkerScale, hasDistrictMarker, isBuildingWithContour, twoTierBuildingMarkerScales } from './district-map-visuals';

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

  it('uses exactly two readable marker sizes for small and large buildings', () => {
    const smaller = { ...building, id: 'building-2', contour: building.contour.map((point) => ({ latitude: point.latitude / 2, longitude: point.longitude / 2 })) };
    const largest = { ...building, id: 'building-3', contour: building.contour.map((point) => ({ latitude: point.latitude * 2, longitude: point.longitude * 2 })) };
    const scales = twoTierBuildingMarkerScales([building, smaller, largest], (point) => ({ x: point.longitude * 40, y: point.latitude * 40 }));
    expect(new Set(scales.values()).size).toBe(2);
    expect(scales.get(smaller.id)).toBeLessThan(scales.get(largest.id) ?? 0);
    expect(scales.get(smaller.id)).toBe(0.58);
    expect(scales.get(largest.id)).toBe(0.82);
  });

  it('keeps a tiny number plate visible when neither standard size fits its contour', () => {
    const scales = twoTierBuildingMarkerScales([building], (point) => ({ x: point.longitude, y: point.latitude }));
    expect(scales.get(building.id)).toBeGreaterThan(0);
    expect(scales.get(building.id)).toBeLessThan(0.58);
  });

  it('keeps the complete plate inside a rotated building instead of using its bounding box', () => {
    const rotated: DistrictBuilding = {
      ...building,
      point: { latitude: 0, longitude: 0 },
      contour: [
        { latitude: -1, longitude: 0 },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 0 },
        { latitude: 0, longitude: -1 },
      ],
    };
    const scale = fittedBuildingMarkerScale(rotated, 1, (point) => ({ x: point.longitude * 30, y: point.latitude * 30 }));
    expect(scale).toBeLessThan(0.82);
    expect(scale).toBeGreaterThan(0.58);
  });

  it('moves an old external label anchor back inside a concave building', () => {
    const concave: DistrictBuilding = {
      ...building,
      point: { latitude: 10, longitude: 10 },
      contour: [
        { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 4 },
        { latitude: 1, longitude: 4 }, { latitude: 1, longitude: 1 },
        { latitude: 4, longitude: 1 }, { latitude: 4, longitude: 0 },
      ],
    };
    const anchor = districtObjectMarkerPoint(concave);
    expect(anchor.latitude).toBeLessThan(4);
    expect(anchor.longitude).toBeLessThan(4);
    expect(anchor).not.toEqual(concave.point);
  });

  it('centers a newly opened map on the response boundary', () => {
    const boundary: DistrictBuilding = {
      ...building,
      id: 'boundary',
      objectType: 'territory',
      mapRole: 'response-boundary',
      contour: [{ latitude: 4, longitude: 2 }, { latitude: 8, longitude: 10 }],
    };
    expect(districtResponseBoundaryCenter([building, boundary])).toEqual({ latitude: 6, longitude: 6 });
  });

  it('keeps territory numbers in data without drawing a territory plate', () => {
    const territory: DistrictBuilding = { ...building, objectType: 'territory', number: '0.1' };
    expect(hasDistrictMarker(territory)).toBe(false);
    expect(hasDistrictMarker({ ...building, objectType: 'building', number: '0.2' })).toBe(false);
    expect(hasDistrictMarker({ ...territory, mapRole: 'rescue-service' })).toBe(true);
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
