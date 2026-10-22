import { describe, expect, it } from 'vitest';
import type { DistrictBuilding } from './district-map-model';
import { objectResultText } from './district-object-search';

const building: DistrictBuilding = {
  id: 'building-search',
  kind: 'building',
  objectType: 'building',
  number: '4.12',
  point: { latitude: 67.9, longitude: 32.8 },
  contour: [],
  territoryNames: [],
  inventoryNumber: '',
  planningDocuments: [],
  workshopFull: 'Цех электролиза никеля',
  workshopShort: 'ЦЭН',
  departments: [{ id: 'department-1', fullName: 'Отделение подготовки сырья', shortName: 'ОПС' }],
  sites: [],
  note: '',
  updatedAtIso: '2026-10-23T00:00:00.000Z',
};

describe('district object search result', () => {
  it('shows the workshop and department when a building is found by number', () => {
    expect(objectResultText(building, '4.12')).toEqual({
      title: 'ЦЭН',
      description: 'Отделение подготовки сырья',
    });
  });
});
