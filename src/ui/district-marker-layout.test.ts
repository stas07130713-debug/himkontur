import { describe, expect, it } from 'vitest';
import { declutterDistrictMarkers } from './district-marker-layout';
import {
  districtObjectSearchDescription,
  districtObjectSearchText,
  districtObjectTitle,
  withoutCoordinateSourceNote,
  type DistrictBuilding,
  type DistrictHydrant,
} from './district-map-model';

const base = { point: { latitude: 67.9, longitude: 32.8 }, note: '', updatedAtIso: '2026-10-14T00:00:00.000Z' };
const building: DistrictBuilding = { ...base, id: 'b', kind: 'building', number: '3.15', planningDocuments: [], workshopFull: 'Цех', workshopShort: 'Ц', departments: [], sites: [{ id: 's', fullName: 'Корпус', shortName: 'К' }] };
const hydrant: DistrictHydrant = { ...base, id: 'h', kind: 'hydrant', number: 'ПГ-17', owner: 'Цех', status: 'serviceable', faultDescription: '', network: 'ring', hydrantType: 'standard', pattern: 'moscow', diameterMm: 150, pressureAtm: null, heightMm: 1750, signDistanceLeftM: null, signDistanceRightM: 12, signDistanceForwardM: null, lastInspectionDate: '' };

describe('привязка объектов карты района выезда', () => {
  it('не смещает близкие обозначения от их точных координат', () => {
    const placements = declutterDistrictMarkers([
      { object: building, x: 300, y: 200 },
      { object: hydrant, x: 302, y: 202 },
    ], 800, 600);
    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({ x: 300, y: 200, anchorX: 300, anchorY: 200 });
    expect(placements[1]).toMatchObject({ x: 302, y: 202, anchorX: 302, anchorY: 202 });
  });

  it('сохраняет координату даже у границы карты', () => {
    const [placement] = declutterDistrictMarkers([{ object: hydrant, x: 2, y: 2 }], 300, 200);
    expect(placement).toMatchObject({ x: 2, y: 2, anchorX: 2, anchorY: 2 });
  });
});

describe('поиск объектов карты района выезда', () => {
  it('ищет здание по номеру, полному и сокращённому названию каждого уровня', () => {
    const detailed: DistrictBuilding = {
      ...building,
      workshopFull: 'Химико-металлургический цех',
      workshopShort: 'ХМЦ',
      inventoryNumber: 'ИНВ-0015',
      planningDocuments: [
        { id: 'document-1', kind: 'ПТП', number: '15' },
        { id: 'document-2', kind: 'ПМЛА', number: '3' },
        { id: 'document-3', kind: 'ПЛРН', number: '2' },
      ],
      departments: [{ id: 'd', fullName: 'Производственное отделение', shortName: 'ПО' }],
      sites: [{ id: 's', fullName: 'Участок корпуса № 15', shortName: 'У-15' }],
    };
    const searchable = districtObjectSearchText(detailed);
    for (const query of ['3.15', 'химико-металлургический', 'хмц', 'производственное', 'по', 'корпуса', 'у-15', 'инв-0015', 'птп-15', 'пмла-3', 'плрн-2']) {
      expect(searchable).toContain(query);
    }
    expect(districtObjectTitle(detailed)).toBe('3.15 · У-15');
    expect(districtObjectSearchDescription(detailed)).toContain('Производственное отделение');
  });

  it('включает в поиск гидранта номер, принадлежность и характер неисправности', () => {
    const faulty: DistrictHydrant = { ...hydrant, owner: 'ХМЦ', status: 'faulty', faultDescription: 'Не открывается крышка' };
    const searchable = districtObjectSearchText(faulty);
    expect(searchable).toContain('пг-17');
    expect(searchable).toContain('хмц');
    expect(searchable).toContain('не открывается крышка');
  });

  it('удаляет только устаревшую служебную строку об источнике координат', () => {
    expect(withoutCoordinateSourceNote('Полезное примечание\nИсточник координат и характеристик: файл.kml.\nИсточник сведений о состоянии ПГ: акт.docx.'))
      .toBe('Полезное примечание\nИсточник сведений о состоянии ПГ: акт.docx.');
  });
});
