import { describe, expect, it } from 'vitest';
import { calculate } from '../core/calculation';
import { DEFAULT_INPUT } from './defaults';
import type { DistrictBuilding } from './district-map-model';
import { evaluateRescueServiceWarning } from './rescue-service-warning';

function rescueBuilding(latitude: number, longitude: number): DistrictBuilding {
  return {
    id: 'ass-building', kind: 'building', objectType: 'building', mapRole: 'rescue-service', number: '1.1',
    point: { latitude, longitude },
    contour: [
      { latitude: latitude - 0.00005, longitude: longitude - 0.00005 },
      { latitude: latitude - 0.00005, longitude: longitude + 0.00005 },
      { latitude: latitude + 0.00005, longitude: longitude + 0.00005 },
      { latitude: latitude + 0.00005, longitude: longitude - 0.00005 },
    ],
    territoryNames: [], inventoryNumber: '', planningDocuments: [], workshopFull: 'Аварийно-спасательная служба', workshopShort: 'АСС',
    departments: [], sites: [], note: '', updatedAtIso: '2026-10-24T00:00:00.000Z',
  };
}

describe('automatic rescue-service warning', () => {
  it('reports the ASS building when the downwind plume reaches its contour', () => {
    const result = calculate(DEFAULT_INPUT);
    const building = rescueBuilding(DEFAULT_INPUT.sourcePoint.latitude, DEFAULT_INPUT.sourcePoint.longitude + 0.001);
    const warning = evaluateRescueServiceWarning(result, [building]);
    expect(warning?.building.id).toBe(building.id);
    expect(warning?.status.willBeAffected).toBe(true);
  });

  it('does not report a building outside the plume sector', () => {
    const result = calculate(DEFAULT_INPUT);
    const building = rescueBuilding(DEFAULT_INPUT.sourcePoint.latitude + 0.001, DEFAULT_INPUT.sourcePoint.longitude);
    expect(evaluateRescueServiceWarning(result, [building])).toBeNull();
  });
});
