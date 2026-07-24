import { describe, expect, it } from 'vitest';
import { pointToSegmentDistance, resizeBoxByHandle, segmentIntersectsRect } from './viewer.js';

const box = { left: 10, bottom: 20, right: 110, top: 70 };

describe('resizeBoxByHandle', () => {
  it('keeps unconstrained corner resizing unchanged', () => {
    expect(resizeBoxByHandle(box, 2, { x: 160, y: 100 })).toEqual({
      left: 10,
      bottom: 20,
      right: 160,
      top: 100,
    });
  });

  it('preserves aspect ratio from the opposite corner', () => {
    const resized = resizeBoxByHandle(box, 2, { x: 160, y: 80 }, true);
    expect(resized).toEqual({ left: 10, bottom: 20, right: 160, top: 95 });
    expect((resized.right - resized.left) / (resized.top - resized.bottom)).toBe(2);
  });

  it('preserves aspect ratio across a corner crossing', () => {
    const resized = resizeBoxByHandle(box, 0, { x: 130, y: 10 }, true);
    expect((resized.right - resized.left) / (resized.top - resized.bottom)).toBeCloseTo(2);
    expect(resized.left).toBe(110);
    expect(resized.top).toBe(20);
  });

  it('resizes the perpendicular dimension symmetrically for an edge handle', () => {
    const resized = resizeBoxByHandle(box, 3, { x: 210, y: 45 }, true);
    expect(resized).toEqual({ left: 10, bottom: -5, right: 210, top: 95 });
  });
});

describe('pointToSegmentDistance', () => {
  it('measures perpendicular distance beside a segment', () => {
    expect(pointToSegmentDistance({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
  });

  it('measures endpoint distance beyond a segment', () => {
    expect(pointToSegmentDistance({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('handles a zero-length segment', () => {
    expect(pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('segmentIntersectsRect', () => {
  const rect = { left: 4, top: 4, right: 8, bottom: 8 };

  it('detects a segment crossing the rectangle', () => {
    expect(segmentIntersectsRect({ x: 0, y: 6 }, { x: 12, y: 6 }, rect)).toBe(true);
  });

  it('rejects a point inside only the segment bounding box', () => {
    expect(segmentIntersectsRect({ x: 0, y: 0 }, { x: 12, y: 12 }, { left: 4, top: 7, right: 5, bottom: 8 })).toBe(
      false,
    );
  });

  it('detects an endpoint inside the rectangle', () => {
    expect(segmentIntersectsRect({ x: 5, y: 5 }, { x: 12, y: 12 }, rect)).toBe(true);
  });
});
