import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPendingDistrictMapOperation,
  districtObjectTitle,
  isPublishedProjectNewer,
  loadPendingDistrictMapOperations,
  parseDistrictMapBackup,
  savePendingDistrictMapOperations,
  serializeDistrictMapBackup,
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
