import type { GeoPoint } from '../core/types';

export type GeoBounds = { west: number; east: number; south: number; north: number };
export function boundsForPoints(points: readonly GeoPoint[]): GeoBounds {
  return points.reduce((box, point) => ({
    west: Math.min(box.west, point.longitude), east: Math.max(box.east, point.longitude),
    south: Math.min(box.south, point.latitude), north: Math.max(box.north, point.latitude),
  }), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
}
export function boundsIntersect(a: GeoBounds, b: GeoBounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

export function createFrameQueue<T>(apply: (value: T) => void, request: (callback: FrameRequestCallback) => number, cancel: (id: number) => void) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    const next = pending; pending = null;
    if (next) apply(next.value);
  };
  return {
    push(value: T) { pending = { value }; frame ??= request(flush); },
    flush,
    dispose() { if (frame !== null) cancel(frame); frame = null; pending = null; },
  };
}
