import { describe, expect, it } from 'vitest';
import { resizeBoxByHandle } from './viewer.js';

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
