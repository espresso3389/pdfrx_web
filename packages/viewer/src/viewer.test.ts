import { describe, expect, it } from 'vitest';
import {
  clientPointToPagePx,
  constrainAnnotationTranslation,
  pointToSegmentDistance,
  resizeBoxByHandle,
  segmentIntersectsRect,
  translateSpec,
} from './viewer.js';

const box = { left: 10, bottom: 20, right: 110, top: 70 };

describe('clientPointToPagePx', () => {
  it('maps client coordinates through the rendered SVG rectangle', () => {
    expect(
      clientPointToPagePx(
        { left: 40, top: 80, width: 300, height: 400 },
        { width: 600, height: 800 },
        190,
        280,
      ),
    ).toEqual({ x: 300, y: 400 });
  });

  it('stays correct when an ancestor CSS transform scales the rendered rectangle', () => {
    expect(
      clientPointToPagePx(
        { left: 20, top: 30, width: 150, height: 200 },
        { width: 600, height: 800 },
        95,
        130,
      ),
    ).toEqual({ x: 300, y: 400 });
  });
});

describe('constrainAnnotationTranslation', () => {
  it('keeps an ordinary object fully within the page', () => {
    const annotation = { left: 20, top: 30, right: 80, bottom: 90 };
    const page = { width: 200, height: 240 };
    expect(constrainAnnotationTranslation(annotation, { x: -100, y: -100 }, page)).toEqual({ x: -20, y: -30 });
    expect(constrainAnnotationTranslation(annotation, { x: 200, y: 200 }, page)).toEqual({ x: 120, y: 150 });
  });

  it('leaves a recoverable strip of an object larger than the page', () => {
    const annotation = { left: -50, top: -80, right: 250, bottom: 320 };
    const page = { width: 200, height: 240 };
    expect(constrainAnnotationTranslation(annotation, { x: -1000, y: -1000 }, page)).toEqual({ x: -249, y: -319 });
    expect(constrainAnnotationTranslation(annotation, { x: 1000, y: 1000 }, page)).toEqual({ x: 249, y: 319 });
  });
});

describe('translateSpec', () => {
  it('preserves a raster appearance by reference while translating geometry', () => {
    const appearanceImage = { width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 4]) };
    const source = {
      subtype: 'stamp' as const,
      rect: { left: 10, bottom: 20, right: 30, top: 40 },
      appearanceImage,
      geometry: { kind: 'line' as const, start: { x: 10, y: 20 }, end: { x: 30, y: 40 } },
    };

    const translated = translateSpec(source, 5, -3);

    expect(translated.appearanceImage).toBe(appearanceImage);
    expect(translated.rect).toEqual({ left: 15, bottom: 17, right: 35, top: 37 });
    expect(translated.geometry).toEqual({ kind: 'line', start: { x: 15, y: 17 }, end: { x: 35, y: 37 } });
    expect(source.rect).toEqual({ left: 10, bottom: 20, right: 30, top: 40 });
  });
});

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
