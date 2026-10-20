/**
 * Keeps a dispatch diagram readable by selecting only the main, well-spaced
 * walls of an irregular contour. Rectangles retain all four dimensions.
 */
export function representativeDimensionIndices(distances: readonly number[]): readonly number[] {
  if (distances.length <= 4) return distances.map((_, index) => index);
  const longest = Math.max(0, ...distances);
  const minimum = Math.max(8, longest * 0.18);
  const ranked = distances
    .map((distance, index) => ({ distance, index }))
    .filter(({ distance }) => distance >= minimum)
    .sort((left, right) => right.distance - left.distance);
  const selected: number[] = [];
  const circularGap = (left: number, right: number) => Math.min(Math.abs(left - right), distances.length - Math.abs(left - right));

  for (const candidate of ranked) {
    if (selected.every((index) => circularGap(index, candidate.index) > 1)) selected.push(candidate.index);
    if (selected.length === 4) break;
  }
  for (const candidate of ranked) {
    if (!selected.includes(candidate.index)) selected.push(candidate.index);
    if (selected.length === 4) break;
  }
  return selected;
}
