import { describe, expect, it } from 'vitest';
import { PILOT_RAW_SOURCE_DATA, PILOT_SUBSTANCE_DATA, buildSubstanceDataLayers } from './substanceDataPipeline';
import { VALIDATED_SUBSTANCES_PILOT } from './validatedSubstancesPilot';

describe('raw → normalized → published pilot pipeline', () => {
  it('publishes all and only the five independently validated pilot records', () => {
    expect(PILOT_SUBSTANCE_DATA.raw).toHaveLength(5);
    expect(PILOT_SUBSTANCE_DATA.normalized).toHaveLength(5);
    expect(PILOT_SUBSTANCE_DATA.published).toHaveLength(5);
    expect(PILOT_SUBSTANCE_DATA.rejected).toEqual([]);
  });

  it('blocks a normalized record without its immutable raw snapshot', () => {
    const layers = buildSubstanceDataLayers(PILOT_RAW_SOURCE_DATA.slice(1), VALIDATED_SUBSTANCES_PILOT);
    expect(layers.published.some((record) => record.transport.unNumber.value === '1017')).toBe(false);
    expect(layers.rejected[0]?.reasons).toContain('CRITICAL: RAW_SOURCE_MISSING');
  });
});
