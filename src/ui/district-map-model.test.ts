import { describe, expect, it } from 'vitest';
import { isPublishedProjectNewer, parseDistrictMapBackup, serializeDistrictMapBackup, type DistrictMapProject } from './district-map-model';

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
