import { describe, expect, it } from 'vitest';
import { VALIDATED_SUBSTANCES_PILOT } from './validatedSubstancesPilot';
import { validateSubstanceRecord } from './validatedSubstanceValidator';

describe('pilot validated substance records', () => {
  it('contains exactly the five approved pilot UN entries', () => {
    expect(VALIDATED_SUBSTANCES_PILOT.map((record) => record.transport.unNumber.value)).toEqual(['1017', '1005', '1050', '1824', '1972']);
  });
  for (const record of VALIDATED_SUBSTANCES_PILOT) it(`validates UN ${record.transport.unNumber.value}`, () => {
    const result = validateSubstanceRecord(record);
    expect(result.issues.filter((issue) => issue.severity === 'CRITICAL' || issue.severity === 'HIGH')).toEqual([]);
    expect(result.validForPublication).toBe(true);
  });
  it('keeps group rail cards out of individual properties', () => {
    for (const record of VALIDATED_SUBSTANCES_PILOT) expect(record.emergency.mainProperties.sourceIds.some((id) => id.startsWith('rail-'))).toBe(false);
  });
  it('does not contaminate sodium hydroxide with ammonia properties', () => {
    const sodium = VALIDATED_SUBSTANCES_PILOT.find((record) => record.transport.unNumber.value === '1824');
    expect(sodium).toBeDefined();
    const text = sodium?.emergency.mainProperties.value?.join(' ') ?? '';
    expect(text).not.toMatch(/пары? аммиака|аммиак легче воздуха/iu);
  });
  it('marks refrigerated methane as cryogenic and does not neutralize it chemically', () => {
    const methane = VALIDATED_SUBSTANCES_PILOT.find((record) => record.transport.unNumber.value === '1972');
    expect(methane?.emergency.flags.isCryogenic).toBe(true);
    expect(methane?.emergency.consequenceControl.value?.operation).toBe('no_neutralization');
  });
});
