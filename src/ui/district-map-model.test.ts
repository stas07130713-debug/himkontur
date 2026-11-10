import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chunkDistrictMapObjectChanges,
  compareDistrictMapBackupObjects,
  compareDistrictMapObjects,
  createPendingDistrictMapOperation,
  districtMapObjectCounts,
  districtMapObjectChanges,
  districtMapObjectChangeSignature,
  districtObjectTitle,
  isPublishedProjectNewer,
  loadPendingDistrictMapOperations,
  mergeDistrictMapBackupObjects,
  parseDistrictMapBackup,
  savePendingDistrictMapOperations,
  serializeDistrictMapBackup,
  shouldAdoptSharedDistrictMap,
  unconfirmedDistrictMapObjectChanges,
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

});

describe('district map composition comparison', () => {
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

  it('merges only new and changed file objects while retaining current-only objects', () => {
    const currentOnly = { ...foamHydrant, id: 'current-only' };
    const changedBuilding = { ...building, number: '1.2', updatedAtIso: '2026-10-26T11:00:00Z' };
    const fileOnly = { ...foamHydrant, id: 'file-only' };
    const comparison = compareDistrictMapBackupObjects(
      [building, currentOnly],
      [changedBuilding, fileOnly],
    );
    expect(comparison).toEqual({ fileOnly: 1, currentOnly: 1, changed: 1, unchanged: 0 });
    expect(mergeDistrictMapBackupObjects([building, currentOnly], [changedBuilding, fileOnly]))
      .toEqual([changedBuilding, currentOnly, fileOnly]);
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

  it('preserves the hierarchy between a site and its department', () => {
    const source = project(29, '2026-10-24T08:00:00Z');
    const hierarchical = {
      ...building,
      departments: [{ id: 'department-1', fullName: 'Основное отделение', shortName: 'ОО' }],
      sites: [{ id: 'site-1', fullName: 'Участок подготовки', shortName: 'УП', parentDepartmentId: 'department-1' }],
    };
    const restored = parseDistrictMapBackup(serializeDistrictMapBackup({ ...source, draft: [hierarchical], published: [hierarchical] }));
    expect(restored?.published[0]).toMatchObject({
      departments: [{ id: 'department-1' }],
      sites: [{ id: 'site-1', parentDepartmentId: 'department-1' }],
    });
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

describe('object upload fragments', () => {
  it('splits a large change set into deterministic small chunks', () => {
    const changes = Array.from({ length: 19 }, (_, index) => ({
      objectId: `building-${index}`,
      baseObject: null,
      object: { ...building, id: `building-${index}` },
      updatedAtIso: building.updatedAtIso,
      targetRevision: 20,
    }));
    const chunks = chunkDistrictMapObjectChanges(changes);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 1]);
    expect(chunks.flat().map((change) => change.objectId)).toEqual(changes.map((change) => change.objectId));
  });

  it('keeps an oversized single object as its own fragment', () => {
    const change = {
      objectId: 'large-building',
      baseObject: null,
      object: { ...building, id: 'large-building', note: 'Контур'.repeat(10_000) },
      updatedAtIso: building.updatedAtIso,
      targetRevision: 20,
    };
    expect(chunkDistrictMapObjectChanges([change])).toEqual([[change]]);
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

  it('keeps the stable operation id and confirmed fragment cursor after another local edit', () => {
    const base = project(100, '2026-11-05T08:00:00Z');
    const firstProject = { ...project(101, '2026-11-05T08:01:00Z'), published: [building], draft: [building] };
    const first = createPendingDistrictMapOperation(100, firstProject, base);
    const checkpoint = {
      ...first,
      baseRevision: 101,
      confirmedObjects: [{ objectId: building.id, signature: 'confirmed-signature' }],
      nextChunkSequence: 2,
    };
    const edited = { ...firstProject, revision: 102, publishedAtIso: '2026-11-05T08:02:00Z' };
    const resumed = createPendingDistrictMapOperation(checkpoint.baseRevision, edited, base, checkpoint);
    expect(resumed).toMatchObject({
      operationId: first.operationId,
      createdAtIso: first.createdAtIso,
      nextChunkSequence: 2,
      confirmedObjects: checkpoint.confirmedObjects,
    });
  });

  it('does not resend a confirmed object unless that object changes again', () => {
    const base = project(100, '2026-11-05T08:00:00Z');
    const firstProject = { ...project(101, '2026-11-05T08:01:00Z'), published: [building], draft: [building] };
    const change = districtMapObjectChanges(base, firstProject)[0];
    expect(change).toBeDefined();
    if (change === undefined) throw new Error('Изменение объекта не создано.');
    const operation = {
      ...createPendingDistrictMapOperation(100, firstProject, base),
      confirmedObjects: [{ objectId: building.id, signature: districtMapObjectChangeSignature(change) }],
      nextChunkSequence: 2,
    };
    expect(unconfirmedDistrictMapObjectChanges(operation, [change])).toEqual([]);
    const edited = { ...building, note: 'изменён после подтверждения', updatedAtIso: '2026-11-05T08:02:00Z' };
    const editedProject = { ...firstProject, published: [edited], draft: [edited] };
    const editedChange = districtMapObjectChanges(base, editedProject)[0];
    if (editedChange === undefined) throw new Error('Повторное изменение объекта не создано.');
    expect(unconfirmedDistrictMapObjectChanges({ ...operation, project: editedProject }, [editedChange])).toEqual([editedChange]);
  });
});
