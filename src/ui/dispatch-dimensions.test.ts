import { describe, expect, it } from 'vitest';
import { representativeDimensionIndices } from './dispatch-dimensions';

describe('dispatch diagram dimensions', () => {
  it('keeps every side of a rectangle', () => {
    expect(representativeDimensionIndices([60, 20, 60, 20])).toEqual([0, 1, 2, 3]);
  });

  it('limits an irregular contour to four readable main dimensions', () => {
    const selected = representativeDimensionIndices([58, 13, 27, 47, 11, 52, 55, 16, 65, 19, 10]);
    expect(selected).toHaveLength(4);
    expect(selected).toContain(8);
    expect(selected).not.toContain(4);
    expect(selected).not.toContain(10);
  });
});
