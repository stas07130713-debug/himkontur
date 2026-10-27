import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareDistrictMapObjects,
  createPendingDistrictMapOperation,
  districtMapObjectCounts,
  districtMapObjectChanges,
  districtObjectTitle,
  isPublishedProjectNewer,
  localOnlyDistrictMapObjects,
  loadPendingDistrictMapOperations,
  parseDistrictMapBackup,
  savePendingDistrictMapOperations,
  serializeDistrictMapBackup,
  shouldAdoptSharedDistrictMap,
  type DistrictMapProject,
} from './district-map-model';

function project(revision: number, publishedAtIso: string): DistrictMapProject {
  return {
    id: 'district-map-main',
    name: 'Карта района выезда',
    revision,
    draft: [],
    published: [],
    draftSavedAtIso: publishedAtIso,
    publishedAtIso,
  };
}

describe('published district project ordering', () => {
  it('prefers a greater revision', () => {
    expect(isPublishedProjectNewer(project(3, '2026-01-01T00:00:00Z'), project(2, '2026-12-01T00:00:00Z'))).toBe(true);
  });

  it('uses publication time when revisions are equal', () => {
    expect(isPublishedProjectNewer(project(3, '2026-02-01T00:00:00Z'), project(3, '2026-01-01T00:00:00Z'))).toBe(true);
    expect(isPublishedProjectNewer(project(3, '2025-12-01T00:00:00Z'), project(3, '2026-01-01T00:00:00Z'))).toBe(false);
  });

  it('accepts the authoritative shared map over a stale local revision', () => {
    const shared = project(100, '2026-10-26T10:00:00Z');
    const staleLocal = project(999_999, '2026-10-22T10:00:00Z');
    expect(shouldAdoptSharedDistrictMap(shared, staleLocal, true)).toBe(true);
    expect(shouldAdoptSharedDistrictMap(shared, staleLocal, false)).toBe(false);
  });

  it('detects locally preserved objects that never reached the shared map', () => {
    const localBuilding = {
      id: 'local-building', kind: 'building' as const, objectType: 'building' as const,
      point: { latitude: 67.9, longitude: 32.8 }, contour: [], territoryNames: [], number: '9.9',
      inventoryNumber: '', planningDocuments: [], workshopFull: '', workshopShort: '', departments: [], sites: [], note: '',
      updatedAtIso: '2026-10-22T10:00:00Z',
    };
    const local = { ...project(12, '2026-10-22T10:00:00Z'), draft: [localBuilding], published: [localBuilding] };
    const shared = project(20, '2026-10-26T10:00:00Z');
    expect(localOnlyDistrictMapObjects(local, shared)).toEqual([localBuilding]);
    expect(localOnlyDistrictMapObjects(shared, local)).toEqual([]);
  });
});

describe('district map composition comparison', () => {
  const building = {
    id: 'building-1', kind: 'building' as const, objectType: 'building' as const,
    point: { latitude: 67.9, longitude: 32.8 }, contour: [], territoryNames: [], number: '1.1',
    inventoryNumber: '', planningDocuments: [], workshopFull: '', workshopShort: '', departments: [], sites: [], note: '',
    updatedAtIso: '2026-10-26T10:00:00Z',
  };
  const foamHydrant = {
    id: 'hydrant-foam', kind: 'hydrant' as const, number: 'ПГ-1', owner: '', status: 'serviceable' as const,
    faultDescription: '', network: 'ring' as const, hydrantType: 'foam' as const, pattern: 'moscow' as const,
    diameterMm: 150, pressureAtm: null, heightMm: null, signDistanceLeftM: null, signDistanceRightM: null,
    signDistanceForwardM: null, lastInspectionDate: '', point: { latitude: 67.91, longitude: 32.81 }, note: '',
    updatedAtIso: '2026-10-26T10:00:00Z',
  };

  it('counts map object groups without double-counting the total', () => {
    expect(districtMapObjectCounts([building, foamHydrant])).toMatchObject({
      buildings: 1,
      waterSources: 1,
      standardHydrants: 0,
      foamHydrants: 1,
      reservoirs: 0,
      total: 2,
    });
  });

  it('reports local-only, server-only, and changed objects separately', () => {
    const changedBuilding = { ...building, number: '1.2', updatedAtIso: '2026-10-26T11:00:00Z' };
    expect(compareDistrictMapObjects([building], [changedBuilding, foamHydrant])).toEqual({
      localOnly: 0,
      sharedOnly: 1,
      changed: 1,
    });
  });

  it('turns a complete queued map into small independent object changes', () => {
    const base = { ...project(10, '2026-10-26T10:00:00Z'), draft: [building, foamHydrant], published: [building, foamHydrant] };
    const movedHydrant = { ...foamHydrant, point: { latitude: 67.92, longitude: 32.82 }, updatedAtIso: '2026-10-26T11:00:00Z' };
    const target = { ...project(11, '2026-10-26T11:00:00Z'), draft: [building, movedHydrant], published: [building, movedHydrant] };
    expect(districtMapObjectChanges(base, target)).toEqual([expect.objectContaining({
      objectId: foamHydrant.id,
      baseObject: foamHydrant,
      object: movedHydrant,
    })]);
  });
});

describe('district map backup', () => {
  it('round-trips the complete project without changing it', () => {
    const source = project(27, '2026-10-20T08:00:00Z');
    expect(parseDistrictMapBackup(serializeDistrictMapBackup(source))).toEqual(source);
  });

  it('rejects an unrelated json file', () => {
    expect(parseDistrictMapBackup('{"hello":"world"}')).toBeNull();
  });

  it('keeps an outdoor installation with index 0 distinct from a territory', () => {
    const source = project(28, '2026-10-23T12:00:00Z');
    const installation = {
      id: 'installation-1',
      kind: 'building' as const,
      objectType: 'installation' as const,
      point: { latitude: 67.9, longitude: 32.8 },
      contour: [
        { latitude: 67.9, longitude: 32.8 },
        { latitude: 67.9, longitude: 32.81 },
        { latitude: 67.91, longitude: 32.81 },
      ],
      territoryNames: [],
      number: '0',
      installationName: 'Открытая насосная установка',
      inventoryNumber: '',
      planningDocuments: [],
      workshopFull: 'Испытательный цех',
      workshopShort: 'ИЦ',
      departments: [],
      sites: [],
      note: 'Проверка наружной установки',
      updatedAtIso: '2026-10-23T12:00:00Z',
    };
    const restored = parseDistrictMapBackup(serializeDistrictMapBackup({
      ...source,
      draft: [installation],
      published: [installation],
    }));
    expect(restored?.published[0]).toMatchObject({
      objectType: 'installation',
      number: '0',
      installationName: 'Открытая насосная установка',
      note: 'Проверка наружной установки',
    });
    expect(restored?.published[0] && districtObjectTitle(restored.published[0])).toBe('Открытая насосная установка');
  });

  it('keeps a demolished contour distinct and without a building card', () => {
    const source = project(29, '2026-10-24T08:00:00Z');
    const demolished = {
      id: 'demolished-1', kind: 'building' as const, objectType: 'demolished' as const,
      point: { latitude: 67.9, longitude: 32.8 },
      contour: [{ latitude: 67.9, longitude: 32.8 }, { latitude: 67.9, longitude: 32.81 }, { latitude: 67.91, longitude: 32.81 }],
      territoryNames: [], number: '0', installationName: '', inventoryNumber: '', planningDocuments: [],
      workshopFull: '', workshopShort: '', departments: [], sites: [], note: '', updatedAtIso: '2026-10-24T08:00:00Z',
    };
    const restored = parseDistrictMapBackup(serializeDistrictMapBackup({ ...source, draft: [demolished], published: [demolished] }));
    expect(restored?.published[0]).toMatchObject({ objectType: 'demolished', number: '0' });
    expect(restored?.published[0] && districtObjectTitle(restored.published[0])).toBe('Демонтированный объект');
  });
});

describe('durable district map operation queue', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('compacts repeated offline edits while preserving the oldest base and newest map', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const firstProject = project(101, '2026-10-22T08:00:00Z');
    const secondProject = project(102, '2026-10-22T08:01:00Z');
    const baseProject = project(100, '2026-10-22T07:59:00Z');
    const first = createPendingDistrictMapOperation(100, firstProject, baseProject);
    const second = createPendingDistrictMapOperation(101, secondProject);
    savePendingDistrictMapOperations([first, second]);
    expect(loadPendingDistrictMapOperations()).toEqual([expect.objectContaining({
      operationId: second.operationId,
      baseRevision: 100,
      baseProject,
      project: secondProject,
      createdAtIso: first.createdAtIso,
    })]);
  });

  it('migrates the old single-project pending format without losing it', () => {
    const legacy = project(55, '2026-10-20T08:00:00Z');
    const values = new Map([['himkontur-district-map-pending-sync-v1', JSON.stringify(legacy)]]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(loadPendingDistrictMapOperations()).toEqual([expect.objectContaining({
      operationId: 'legacy-55',
      baseRevision: 54,
      project: legacy,
    })]);
  });
});
