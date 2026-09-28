import { describe, expect, it } from 'vitest';
import { OPERATIONAL_FACTS_CATALOG } from './operationalFactsCatalog';

describe('operational facts catalog', () => {
  it('describes hydrochloric acid as water-compatible without copying the group-card restriction', () => {
    const hydrochloricAcid = OPERATIONAL_FACTS_CATALOG['1789'];
    expect(hydrochloricAcid?.workplacePdk.value).toBe('5 мг/м³');
    expect(hydrochloricAcid?.water.compatibility).toBe('safe');
    expect(hydrochloricAcid?.water.label).toBe('Совместима с водой');
    expect(hydrochloricAcid?.water.description).toContain('смешивается с водой');
    expect(hydrochloricAcid?.water.description).not.toMatch(/не допускать попадания воды|ограниченно совместимо/iu);
  });
});
