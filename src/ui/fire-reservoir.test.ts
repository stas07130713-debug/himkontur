import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DistrictMapMarker } from './DistrictMapMarker';
import { FireReservoirIndicatorPlate } from './FireReservoirIndicatorPlate';
import {
  districtObjectSearchText,
  districtObjectTitle,
  FIRE_RESERVOIR_TYPE_LABELS,
  type DistrictFireReservoir,
} from './district-map-model';

const reservoir: DistrictFireReservoir = {
  id: 'reservoir-1',
  kind: 'reservoir',
  point: { latitude: 67.92, longitude: 32.84 },
  number: 'ПВ-7',
  owner: 'Химико-металлургический цех',
  status: 'serviceable',
  volumeM3: 250,
  faultDescription: '',
  reservoirType: 'artificial',
  note: 'Контрольная запись',
  updatedAtIso: '2026-10-16T00:00:00.000Z',
};

describe('пожарный водоём на карте', () => {
  it('участвует в поиске НППВ', () => {
    expect(districtObjectTitle(reservoir)).toBe('Пожарный водоём ПВ-7');
    expect(districtObjectSearchText(reservoir)).toContain('искусственный пожарный водоём');
    expect(FIRE_RESERVOIR_TYPE_LABELS['foam-solution']).toContain('раствора пенообразователя');
  });

  it('показывает номер и объём в табличке и на маркере', () => {
    const plate = renderToStaticMarkup(createElement(FireReservoirIndicatorPlate, { object: reservoir }));
    const marker = renderToStaticMarkup(createElement(DistrictMapMarker, { object: reservoir, x: 10, y: 20, selected: false, onSelect: vi.fn() }));
    expect(plate).toContain('ПВ —');
    expect(plate).toContain('250');
    expect(marker).toContain('Пожарный водоём ПВ-7');
    expect(marker).toContain('reservoir-symbol-letters');
    expect(marker).toContain('>ПВ</text>');
  });
});
