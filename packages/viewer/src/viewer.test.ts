import { describe, expect, it } from 'vitest';
import {
  annotationIsEffectivelyInvisible,
  annotationAppearanceColor,
  annotationVisibleInViewer,
  annotationTextCompositionKey,
  annotationTextEntryKey,
  annotationObjectInteractionEnabled,
  annotationSnapshotKey,
  annotationSupportsStyleProperty,
  clientPointToPagePx,
  constrainAnnotationTranslation,
  forwardArmedEditorKeyToViewer,
  pointToSegmentDistance,
  preserveAnnotationSelectionOnEmptySpace,
  isPdfPrintingSupported,
  resizeBoxByHandle,
  segmentIntersectsRect,
  translateSpec,
} from './viewer.js';
import type { PdfAnnotationObject } from '@pdfrx/engine';

const annotationWith = (values: Partial<PdfAnnotationObject>): PdfAnnotationObject => ({
  id: 'a',
  pageNumber: 1,
  subtype: 'square',
  linkTarget: null,
  rect: { left: 0, top: 10, right: 10, bottom: 0 },
  color: null,
  interiorColor: null,
  borderWidth: 0,
  flags: 0,
  contents: null,
  author: null,
  actorId: null,
  revision: 0,
  textOrientation: 0,
  textColor: null,
  fontSize: null,
  textAlign: 'left',
  textVerticalAlign: 'top',
  fontFace: null,
  geometry: { kind: 'none' },
  appearancePaths: [],
  appearanceImage: null,
  ...values,
} as PdfAnnotationObject);

describe('annotationSnapshotKey', () => {
  it('keeps page-local fallback annotation ids distinct across pages', () => {
    expect(annotationSnapshotKey(8, '@0')).not.toBe(annotationSnapshotKey(9, '@0'));
    expect(new Set([
      annotationSnapshotKey(8, '@0'),
      annotationSnapshotKey(9, '@0'),
      annotationSnapshotKey(9, '@1'),
    ])).toHaveLength(3);
  });
});

describe('annotationIsEffectivelyInvisible', () => {
  it('includes links and shapes whose stroke and fill are transparent', () => {
    expect(annotationIsEffectivelyInvisible(annotationWith({ subtype: 'link' }))).toBe(true);
    expect(annotationIsEffectivelyInvisible(annotationWith({
      borderWidth: 2,
      color: { r: 0, g: 0, b: 0, a: 0 },
      interiorColor: { r: 255, g: 0, b: 0, a: 0 },
    }))).toBe(true);
  });

  it('uses 5% as an inclusive invisibility threshold', () => {
    expect(annotationIsEffectivelyInvisible(annotationWith({
      borderWidth: 1,
      color: { r: 0, g: 0, b: 0, a: 12 },
    }))).toBe(true);
    expect(annotationIsEffectivelyInvisible(annotationWith({
      borderWidth: 1,
      color: { r: 0, g: 0, b: 0, a: 13 },
    }))).toBe(false);
  });

  it('keeps visible fills, text, images, and appearance paths unmarked', () => {
    expect(annotationIsEffectivelyInvisible(annotationWith({
      interiorColor: { r: 255, g: 0, b: 0, a: 255 },
    }))).toBe(false);
    expect(annotationIsEffectivelyInvisible(annotationWith({
      subtype: 'freeText',
      contents: 'visible',
      textColor: { r: 0, g: 0, b: 0, a: 255 },
    }))).toBe(false);
    expect(annotationIsEffectivelyInvisible(annotationWith({
      appearanceImage: { width: 1, height: 1, pixels: new Uint8Array(4) },
    }))).toBe(false);
    expect(annotationIsEffectivelyInvisible(annotationWith({
      subtype: 'ink',
      geometry: { kind: 'ink', strokes: [] },
      appearancePaths: [{
        segments: [],
        fillMode: 1,
        fillColor: { r: 0, g: 0, b: 0, a: 255 },
        stroke: false,
        strokeColor: null,
        strokeWidth: 0,
        lineCap: 0,
        lineJoin: 0,
      }],
    }))).toBe(false);
  });
});

describe('annotationVisibleInViewer', () => {
  it('hides annotations suppressed by PDF screen-display flags', () => {
    expect(annotationVisibleInViewer({ flags: 0, subtype: 'text' })).toBe(true);
    expect(annotationVisibleInViewer({ flags: 4 | 8 | 16 | 128, subtype: 'text' })).toBe(true);
    expect(annotationVisibleInViewer({ flags: 1, subtype: 'text' })).toBe(false);
    expect(annotationVisibleInViewer({ flags: 2 | 4 | 8 | 16, subtype: 'text' })).toBe(false);
    expect(annotationVisibleInViewer({ flags: 32, subtype: 'text' })).toBe(false);
    expect(annotationVisibleInViewer({ flags: 32, subtype: 'freeText' })).toBe(true);
    expect(annotationVisibleInViewer({ flags: 2 | 32, subtype: 'freeText' })).toBe(false);
  });
});

describe('annotationAppearanceColor', () => {
  it('falls back to an appearance-path stroke when PDFium does not expose /C', () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    expect(annotationAppearanceColor(annotationWith({
      color: null,
      appearancePaths: [{
        segments: [],
        fillMode: 0,
        fillColor: null,
        stroke: true,
        strokeColor: red,
        strokeWidth: 0.69,
        lineCap: 0,
        lineJoin: 0,
      }],
    }))).toEqual(red);
  });

  it('keeps the annotation color authoritative when both sources exist', () => {
    const primary = { r: 1, g: 2, b: 3, a: 255 };
    expect(annotationAppearanceColor(annotationWith({ color: primary }))).toEqual(primary);
  });
});

describe('annotationObjectInteractionEnabled', () => {
  it('inverts viewing mode while Alt/Option is held', () => {
    expect(annotationObjectInteractionEnabled(false, false)).toBe(false);
    expect(annotationObjectInteractionEnabled(false, true)).toBe(true);
  });

  it('temporarily returns annotation mode to viewing with Alt/Option', () => {
    expect(annotationObjectInteractionEnabled(true, false)).toBe(true);
    expect(annotationObjectInteractionEnabled(true, true)).toBe(false);
  });
});

describe('annotationSupportsStyleProperty', () => {
  it('supports the union UI while keeping each property scoped to eligible annotations', () => {
    const square = annotationWith({ subtype: 'square', contents: null });
    const line = annotationWith({ subtype: 'line' });
    const ink = annotationWith({ subtype: 'ink' });
    expect(annotationSupportsStyleProperty(square, 'fillColor')).toBe(true);
    expect(annotationSupportsStyleProperty(line, 'fillColor')).toBe(false);
    expect(annotationSupportsStyleProperty(square, 'opacity')).toBe(true);
    expect(annotationSupportsStyleProperty(line, 'opacity')).toBe(false);
    expect(annotationSupportsStyleProperty(ink, 'opacity')).toBe(false);
    expect(annotationSupportsStyleProperty(line, 'strokeWidth')).toBe(true);
  });
});

describe('isPdfPrintingSupported', () => {
  it('rejects iPhone/iPad and desktop-mode iPadOS without affecting desktop Safari', () => {
    expect(isPdfPrintingSupported({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })).toBe(false);
    expect(isPdfPrintingSupported({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe(false);
    expect(isPdfPrintingSupported({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })).toBe(true);
  });
});

describe('preserveAnnotationSelectionOnEmptySpace', () => {
  it('preserves objects only for Cmd/Ctrl gestures in object mode', () => {
    expect(preserveAnnotationSelectionOnEmptySpace(true, true)).toBe(true);
    expect(preserveAnnotationSelectionOnEmptySpace(true, false)).toBe(false);
    expect(preserveAnnotationSelectionOnEmptySpace(false, true)).toBe(false);
    expect(preserveAnnotationSelectionOnEmptySpace(false, false)).toBe(false);
  });
});

describe('annotationTextEntryKey', () => {
  it('accepts printable single-character input including Space', () => {
    expect(annotationTextEntryKey('A', false, false, false, false)).toBe('A');
    expect(annotationTextEntryKey(' ', false, false, false, false)).toBe(' ');
  });

  it('rejects shortcuts, navigation keys, and active composition', () => {
    expect(annotationTextEntryKey('a', true, false, false, false)).toBeNull();
    expect(annotationTextEntryKey('a', false, true, false, false)).toBeNull();
    expect(annotationTextEntryKey('a', false, false, true, false)).toBeNull();
    expect(annotationTextEntryKey('ArrowLeft', false, false, false, false)).toBeNull();
    expect(annotationTextEntryKey('Process', false, false, false, true)).toBeNull();
  });
});

describe('annotationTextCompositionKey', () => {
  it('recognizes browser IME keydown variants', () => {
    expect(annotationTextCompositionKey('Process', 0, false)).toBe(true);
    expect(annotationTextCompositionKey('Unidentified', 0, false)).toBe(true);
    expect(annotationTextCompositionKey('a', 229, false)).toBe(true);
    expect(annotationTextCompositionKey('a', 65, true)).toBe(true);
    expect(annotationTextCompositionKey('a', 65, false)).toBe(false);
  });
});

describe('forwardArmedEditorKeyToViewer', () => {
  it('forwards annotation editing/navigation commands', () => {
    expect(forwardArmedEditorKeyToViewer('Delete', false, false)).toBe(true);
    expect(forwardArmedEditorKeyToViewer('ArrowLeft', false, false)).toBe(true);
    expect(forwardArmedEditorKeyToViewer('z', true, false)).toBe(true);
    expect(forwardArmedEditorKeyToViewer('c', false, true)).toBe(true);
  });

  it('leaves platform IME toggles and unknown keys native', () => {
    expect(forwardArmedEditorKeyToViewer('HankakuZenkaku', false, false)).toBe(false);
    expect(forwardArmedEditorKeyToViewer('KanaMode', false, false)).toBe(false);
    expect(forwardArmedEditorKeyToViewer(' ', true, false)).toBe(false);
    expect(forwardArmedEditorKeyToViewer('`', false, false)).toBe(false);
  });
});

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
