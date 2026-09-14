export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function interpolate(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x0 === x1) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export function bracket(values: readonly number[], rawValue: number): readonly [number, number] {
  const value = clamp(rawValue, values[0] ?? rawValue, values.at(-1) ?? rawValue);
  const upperIndex = values.findIndex((candidate) => candidate >= value);
  if (upperIndex <= 0) return [0, 0];
  if (upperIndex === -1) return [values.length - 1, values.length - 1];
  if (values[upperIndex] === value) return [upperIndex, upperIndex];
  return [upperIndex - 1, upperIndex];
}

export function nearlyEqual(a: number, b: number, tolerance = 1e-9): boolean {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
