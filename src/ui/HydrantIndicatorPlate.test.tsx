import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DistrictHydrant } from './district-map-model';
import { HydrantIndicatorPlate } from './HydrantIndicatorPlate';
import { HydrantPlanSymbol } from './DistrictMapMarker';

const foamHydrant: DistrictHydrant = {
  id: 'foam-1', kind: 'hydrant', point: { latitude: 67.9, longitude: 32.8 }, number: 'ПГ-12', owner: '',
  status: 'serviceable', faultDescription: '', network: 'ring', hydrantType: 'foam', pattern: 'moscow',
  diameterMm: 150, pressureAtm: null, heightMm: null, signDistanceLeftM: null, signDistanceRightM: null,
  signDistanceForwardM: null, lastInspectionDate: '', note: '', updatedAtIso: '2026-10-24T00:00:00.000Z',
};

describe('foam hydrant visuals', () => {
  it('labels the indicator plate as ППГ and marks its plan symbol green', () => {
    const plate = renderToStaticMarkup(<HydrantIndicatorPlate object={foamHydrant} />);
    expect(plate).toContain('ППГ');
    expect(plate).toContain('пенного пожарного гидранта');
    const symbol = renderToStaticMarkup(<HydrantPlanSymbol object={foamHydrant} />);
    expect(symbol).toContain('type-foam status-serviceable');
    expect(symbol).toContain('ППГ-12');
  });
});
