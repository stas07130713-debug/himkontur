import { describe, it, expect } from 'vitest';
import { boundsIntersect, boundsForPoints, createFrameQueue } from './district-viewport';

describe('district viewport', () => {
  const screen = { west: 0, east: 10, south: 0, north: 10 };
  it('keeps enclosing contours, crossing contours and edge objects', () => {
    expect(boundsIntersect(screen, { west: -5, east: 15, south: -5, north: 15 })).toBe(true);
    expect(boundsIntersect(screen, { west: -5, east: 15, south: 4, north: 5 })).toBe(true);
    expect(boundsIntersect(screen, boundsForPoints([{ longitude: 10, latitude: 5 }]))).toBe(true);
    expect(boundsIntersect(screen, boundsForPoints([{ longitude: 11, latitude: 5 }]))).toBe(false);
  });
  it('coalesces moves and flushes the last position on release', () => {
    let callback: FrameRequestCallback = () => undefined;
    let requests = 0;
    const applied: number[] = [];
    const queue = createFrameQueue<number>((n) => applied.push(n), (fn) => { callback = fn; return ++requests; }, () => undefined);
    queue.push(1); queue.push(2); queue.push(3);
    expect(requests).toBe(1);
    callback(0);
    expect(applied).toEqual([3]);
    queue.push(4); queue.flush(); callback(0);
    expect(applied).toEqual([3, 4]);
    queue.push(5); queue.dispose(); callback(0);
    expect(applied).toEqual([3, 4]);
  });
});
