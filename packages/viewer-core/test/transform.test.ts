import { describe, expect, it } from 'vitest';
import {
  adjustBoundaryMargins,
  calcOverscroll,
  calcPosition,
  calcRectForArea,
  calcTransformFor,
  calcTransformForRect,
  calcVisibleRect,
  clampToBoundary,
  documentToView,
  edgeInsetsZero,
  viewToDocument,
  type ViewTransform,
} from '../src/index.js';

const viewSize = { width: 800, height: 600 };

describe('ViewTransform basics', () => {
  const t: ViewTransform = { zoom: 2, xZoomed: -100, yZoomed: -50 };

  it('calcPosition returns the document point at the view center', () => {
    expect(calcPosition(t, viewSize)).toEqual({ x: 250, y: 175 });
  });

  it('calcVisibleRect covers viewSize/zoom around the position', () => {
    expect(calcVisibleRect(t, viewSize)).toEqual({ left: 50, top: 25, right: 450, bottom: 325 });
  });

  it('viewToDocument and documentToView are inverses', () => {
    const local = { x: 123, y: 456 };
    const doc = viewToDocument(t, local);
    expect(documentToView(t, doc)).toEqual(local);
  });
});

describe('calcTransformFor / calcTransformForRect', () => {
  it('centers the given position', () => {
    const t = calcTransformFor({ x: 100, y: 50 }, 4, viewSize);
    expect(t).toEqual({ zoom: 4, xZoomed: 0, yZoomed: 100 });
    expect(calcPosition(t, viewSize)).toEqual({ x: 100, y: 50 });
  });

  it('fits a rect into the view', () => {
    const t = calcTransformForRect({ left: 0, top: 0, right: 200, bottom: 100 }, viewSize);
    expect(t.zoom).toBe(4); // min(800/200, 600/100) = min(4, 6)
    expect(calcPosition(t, viewSize)).toEqual({ x: 100, y: 50 });
  });

  it('respects zoomMax', () => {
    const t = calcTransformForRect({ left: 0, top: 0, right: 200, bottom: 100 }, viewSize, { zoomMax: 2 });
    expect(t.zoom).toBe(2);
  });
});

describe('calcRectForArea anchors', () => {
  const rect = { left: 0, top: 0, right: 1000, bottom: 2000 };
  const visibleSize = { width: 400, height: 300 };

  it('top anchor keeps full width, clamps height', () => {
    expect(calcRectForArea(rect, 'top', visibleSize)).toEqual({ left: 0, top: 0, right: 1000, bottom: 300 });
  });

  it('topLeft anchor uses the visible size', () => {
    expect(calcRectForArea(rect, 'topLeft', visibleSize)).toEqual({ left: 0, top: 0, right: 400, bottom: 300 });
  });

  it('bottomRight anchor aligns to the bottom-right corner', () => {
    expect(calcRectForArea(rect, 'bottomRight', visibleSize)).toEqual({
      left: 600,
      top: 1700,
      right: 1000,
      bottom: 2000,
    });
  });

  it('all returns the rect unchanged', () => {
    expect(calcRectForArea(rect, 'all', visibleSize)).toEqual(rect);
  });
});

describe('adjustBoundaryMargins (underflow alignment)', () => {
  it('splits horizontal underflow evenly by default', () => {
    const m = adjustBoundaryMargins(viewSize, 1, { width: 400, height: 600 });
    expect(m).toEqual({ left: 200, top: 0, right: 200, bottom: 0 });
  });

  it('aligns to the left for left-ish anchors', () => {
    const m = adjustBoundaryMargins(viewSize, 1, { width: 400, height: 600 }, edgeInsetsZero, 'topLeft');
    expect(m).toEqual({ left: 0, top: 0, right: 400, bottom: 0 });
  });

  it('accounts for zoom', () => {
    // zoomed 2x: doc 300 -> 600 effective, underflow 200 view px = 100 doc units
    const m = adjustBoundaryMargins(viewSize, 2, { width: 300, height: 300 });
    expect(m).toEqual({ left: 50, top: 0, right: 50, bottom: 0 });
  });

  it('passes through infinite margins', () => {
    const inf = { left: Infinity, top: Infinity, right: Infinity, bottom: Infinity };
    expect(adjustBoundaryMargins(viewSize, 1, { width: 400, height: 600 }, inf)).toBe(inf);
  });
});

describe('calcOverscroll / clampToBoundary', () => {
  const docSize = { width: 1000, height: 1000 };
  const view = { width: 500, height: 500 };

  it('no overscroll inside boundary', () => {
    const t: ViewTransform = { zoom: 1, xZoomed: 0, yZoomed: 0 };
    expect(calcOverscroll(t, view, docSize, edgeInsetsZero)).toEqual({ x: 0, y: 0 });
    expect(clampToBoundary(t, view, docSize, edgeInsetsZero)).toBe(t);
  });

  it('clamps when panned past the left edge', () => {
    // xZoomed=100 shows 100px of empty space to the left of the document
    const t: ViewTransform = { zoom: 1, xZoomed: 100, yZoomed: 0 };
    expect(calcOverscroll(t, view, docSize, edgeInsetsZero)).toEqual({ x: 100, y: 0 });
    expect(clampToBoundary(t, view, docSize, edgeInsetsZero)).toEqual({ zoom: 1, xZoomed: 0, yZoomed: 0 });
  });

  it('clamps when panned past the bottom edge', () => {
    // visible bottom = (500 - yZoomed) = 1100 > 1000
    const t: ViewTransform = { zoom: 1, xZoomed: 0, yZoomed: -600 };
    expect(calcOverscroll(t, view, docSize, edgeInsetsZero)).toEqual({ x: 0, y: -100 });
    expect(clampToBoundary(t, view, docSize, edgeInsetsZero)).toEqual({ zoom: 1, xZoomed: 0, yZoomed: -500 });
  });

  it('centers the document when it is smaller than the view', () => {
    const smallDoc = { width: 300, height: 300 };
    const t: ViewTransform = { zoom: 1, xZoomed: 0, yZoomed: 0 };
    const clamped = clampToBoundary(t, view, smallDoc, edgeInsetsZero);
    // Document [0,300] centered in visible [-100,400]
    expect(clamped).toEqual({ zoom: 1, xZoomed: 100, yZoomed: 100 });
  });

  it('zoomed clamp converts document overscroll to view units', () => {
    const t: ViewTransform = { zoom: 2, xZoomed: 50, yZoomed: 0 };
    // visible.left = (0 - 50)/2 = -25 -> overscroll x = 25 doc units
    expect(calcOverscroll(t, view, docSize, edgeInsetsZero)).toEqual({ x: 25, y: 0 });
    expect(clampToBoundary(t, view, docSize, edgeInsetsZero)).toEqual({ zoom: 2, xZoomed: 0, yZoomed: 0 });
  });
});
