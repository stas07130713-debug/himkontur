import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DistrictBuilding, DistrictHydrant, DistrictMapObject, DistrictMapProject } from './district-map-model';
import { clearDistrictMapConflictArchives, districtMapConflictArchiveCount, mergeDistrictMapProjects, saveDistrictMapConflictArchive, serializeDistrictMapConflictReport } from './district-map-merge';

function building(id: string, name: string, updatedAtIso: string): DistrictBuilding {
  return {
    id,
    kind: 'building',
    objectType: 'building',
    point: { latitude: 67.9, longitude: 32.8 },
    contour: [],
    territoryNames: [],
    number: id,
    inventoryNumber: '',
    planningDocuments: [],
    workshopFull: name,
    workshopShort: '',
    departments: [],
    sites: [],
    note: '',
    updatedAtIso,
  };
}

function hydrant(id: string, updatedAtIso: string): DistrictHydrant {
  return {
    id,
    kind: 'hydrant',
    point: { latitude: 67.9, longitude: 32.8 },
    number: 'ПГ-1',
    owner: '',
    status: 'serviceable',
    faultDescription: '',
    network: 'ring',
    hydrantType: 'standard',
    pattern: 'moscow',
    diameterMm: 100,
    pressureAtm: null,
    heightMm: null,
    signDistanceLeftM: null,
    signDistanceRightM: null,
    signDistanceForwardM: null,
    lastInspectionDate: '',
    note: '',
    updatedAtIso,
  };
}

function project(revision: number, objects: readonly DistrictMapObject[]): DistrictMapProject {
  return {
    id: 'district-map-main',
    name: 'Карта района выезда',
    revision,
    draft: objects,
    published: objects,
    draftSavedAtIso: '2026-10-23T00:00:00.000Z',
    publishedAtIso: '2026-10-23T00:00:00.000Z',
  };
}

describe('conflict-safe district map merge', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('combines changes to different objects from two computers', () => {
    const first = building('1.1', 'Цех 1', '2026-10-23T08:00:00.000Z');
    const second = building('2.1', 'Цех 2', '2026-10-23T08:00:00.000Z');
    const base = project(10, [first, second]);
    const local = project(11, [{ ...first, note: 'Изменено дома', updatedAtIso: '2026-10-23T10:00:00.000Z' }, second]);
    const remote = project(12, [first, { ...second, note: 'Изменено на работе', updatedAtIso: '2026-10-23T09:00:00.000Z' }]);
    const merged = mergeDistrictMapProjects(base, local, remote);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.project.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1.1', note: 'Изменено дома' }),
      expect.objectContaining({ id: '2.1', note: 'Изменено на работе' }),
    ]));
  });

  it('keeps a moved hydrant together with an unrelated remote object edit', () => {
    const sourceHydrant = hydrant('hydrant-1', '2026-10-23T08:00:00.000Z');
    const sourceBuilding = building('1.1', 'Цех 1', '2026-10-23T08:00:00.000Z');
    const base = project(10, [sourceHydrant, sourceBuilding]);
    const movedHydrant = { ...sourceHydrant, point: { latitude: 67.91, longitude: 32.81 }, updatedAtIso: '2026-10-23T10:00:00.000Z' };
    const editedBuilding = { ...sourceBuilding, note: 'Изменено на другом устройстве', updatedAtIso: '2026-10-23T09:00:00.000Z' };
    const merged = mergeDistrictMapProjects(project(10, base.published), project(11, [movedHydrant, sourceBuilding]), project(12, [sourceHydrant, editedBuilding]));
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.project.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hydrant-1', point: movedHydrant.point }),
      expect.objectContaining({ id: '1.1', note: editedBuilding.note }),
    ]));
  });

  it('keeps a remote deletion while publishing an unrelated local object edit', () => {
    const deletedRemotely = building('1.1', 'Удаляемый объект', '2026-10-23T08:00:00.000Z');
    const editedLocally = building('2.1', 'Редактируемый объект', '2026-10-23T08:00:00.000Z');
    const localEdit = { ...editedLocally, note: 'Изменён на другом компьютере', updatedAtIso: '2026-10-23T10:00:00.000Z' };
    const merged = mergeDistrictMapProjects(
      project(10, [deletedRemotely, editedLocally]),
      project(11, [deletedRemotely, localEdit]),
      project(12, [editedLocally]),
    );
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.project.published).toEqual([localEdit]);
  });

  it('keeps an edited object instead of silently applying a concurrent deletion', () => {
    const source = building('1.1', 'Цех', '2026-10-23T08:00:00.000Z');
    const local = { ...source, note: 'Новые сведения', updatedAtIso: '2026-10-23T10:00:00.000Z' };
    const merged = mergeDistrictMapProjects(project(10, [source]), project(11, [local]), project(12, []));
    expect(merged.project.published).toContainEqual(local);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.remote).toBeNull();
  });

  it('preserves both variants in the conflict journal and activates the newer one', () => {
    const source = building('1.1', 'Исходный цех', '2026-10-23T08:00:00.000Z');
    const local = { ...source, workshopFull: 'Домашняя версия', updatedAtIso: '2026-10-23T10:00:00.000Z' };
    const remote = { ...source, workshopFull: 'Рабочая версия', updatedAtIso: '2026-10-23T09:00:00.000Z' };
    const merged = mergeDistrictMapProjects(project(10, [source]), project(11, [local]), project(12, [remote]));
    expect(merged.project.published).toContainEqual(local);
    expect(merged.conflicts[0]).toMatchObject({ local, remote, activeSource: 'local' });
  });

  it('uses a conservative union for queues created by older releases', () => {
    const local = building('1.1', 'Локальный объект', '2026-10-23T10:00:00.000Z');
    const remote = building('2.1', 'Облачный объект', '2026-10-23T09:00:00.000Z');
    const merged = mergeDistrictMapProjects(null, project(11, [local]), project(12, [remote]));
    expect(merged.project.published.map((object) => object.id)).toEqual(['2.1', '1.1']);
    expect(merged.conflicts).toHaveLength(0);
  });

  it('exports a readable conflict report and clears it after review', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } });
    const local = building('1.1', 'Домашняя версия', '2026-10-24T10:00:00.000Z');
    const remote = building('1.1', 'Рабочая версия', '2026-10-24T09:00:00.000Z');
    saveDistrictMapConflictArchive({ createdAtIso: '2026-10-24T10:01:00.000Z', baseRevision: 1, localRevision: 2, remoteRevision: 3, conflicts: [{ objectId: '1.1', local, remote, activeSource: 'local' }] });
    const report = serializeDistrictMapConflictReport();
    expect(report).toContain('1.1 · Домашняя версия');
    expect(report).toContain('Полное название цеха');
    expect(report).toContain('Домашняя версия');
    expect(report).toContain('Рабочая версия');
    expect(report).toContain('с этого устройства');
    clearDistrictMapConflictArchives();
    expect(districtMapConflictArchiveCount()).toBe(0);
  });
});
