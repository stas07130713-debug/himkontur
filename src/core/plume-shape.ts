export type PlumeBandKind = 'primary' | 'secondary' | 'combined';

export type PlumeBand = Readonly<{
  fromKm: number;
  toKm: number;
  kind: PlumeBandKind;
}>;

const EPSILON = 1e-9;

export function buildPlumeBands(primaryKm: number, secondaryKm: number, finalKm: number): readonly PlumeBand[] {
  const final = Math.max(0, finalKm);
  const primary = Math.min(final, Math.max(0, primaryKm));
  const secondary = Math.min(final, Math.max(0, secondaryKm));
  const boundaries = [...new Set([0, primary, secondary, final].map((value) => Number(value.toFixed(12))))]
    .filter((value) => value >= 0 && value <= final + EPSILON)
    .sort((left, right) => left - right);
  const bands: PlumeBand[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const fromKm = boundaries[index];
    const toKm = boundaries[index + 1];
    if (fromKm === undefined || toKm === undefined || toKm - fromKm <= EPSILON) continue;
    const midpoint = (fromKm + toKm) / 2;
    const inPrimary = midpoint <= primary + EPSILON;
    const inSecondary = midpoint <= secondary + EPSILON;
    // The shorter cloud is drawn above the longer one in their common part, so
    // both calculated boundaries remain visible without blending the colours.
    const sharedKind: PlumeBandKind = primary <= secondary ? 'primary' : 'secondary';
    const kind: PlumeBandKind = inPrimary && inSecondary ? sharedKind : inPrimary ? 'primary' : inSecondary ? 'secondary' : 'combined';
    const previous = bands.at(-1);
    if (previous?.kind === kind) bands[bands.length - 1] = { ...previous, toKm };
    else bands.push({ fromKm, toKm, kind });
  }
  return bands;
}
