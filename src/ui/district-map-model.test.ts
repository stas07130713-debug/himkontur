import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPendingDistrictMapOperation,
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
});

describe('durable district map operation queue', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores every operation in order instead of replacing the previous edit', () => {
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
    const first = createPendingDistrictMapOperation(100, firstProject);
    const second = createPendingDistrictMapOperation(101, secondProject);
    savePendingDistrictMapOperations([first, second]);
    expect(loadPendingDistrictMapOperations()).toEqual([first, second]);
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
