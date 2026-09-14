import { describe, expect, it } from 'vitest';
import { buildPlumeBands } from './plume-shape';

describe('plume shape bands', () => {
  it('creates non-overlapping bands for secondary-dominant calculation', () => {
    expect(buildPlumeBands(1.83, 6.44, 7.35)).toEqual([
      { fromKm: 0, toKm: 1.83, kind: 'primary' },
      { fromKm: 1.83, toKm: 6.44, kind: 'secondary' },
      { fromKm: 6.44, toKm: 7.35, kind: 'combined' }
    ]);
  });

  it('creates non-overlapping bands for primary-dominant calculation', () => {
    expect(buildPlumeBands(5, 2, 6)).toEqual([
      { fromKm: 0, toKm: 2, kind: 'secondary' },
      { fromKm: 2, toKm: 5, kind: 'primary' },
      { fromKm: 5, toKm: 6, kind: 'combined' }
    ]);
  });

  it('uses primary colour for the physically shared part', () => {
    expect(buildPlumeBands(1.01, 1.01, 1.01)).toEqual([{ fromKm: 0, toKm: 1.01, kind: 'primary' }]);
  });

  it('shows the secondary cloud from the source when the primary layer is hidden', () => {
    expect(buildPlumeBands(0, 2, 3)).toEqual([
      { fromKm: 0, toKm: 2, kind: 'secondary' },
      { fromKm: 2, toKm: 3, kind: 'combined' }
    ]);
  });
});
