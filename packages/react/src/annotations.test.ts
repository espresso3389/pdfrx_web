import {
  deserializeAnnotationSnapshot,
  pdfAnnotationSubtypeFromName,
  PdfAnnotationFlag,
  serializeAnnotationSnapshot,
  type PdfAnnotationSnapshot,
} from '@pdfrx/engine';
import { describe, expect, it } from 'vitest';

describe('pdfAnnotationSubtypeFromName', () => {
  it('passes through the surfaced content subtypes', () => {
    for (const name of [
      'ink',
      'highlight',
      'underline',
      'squiggly',
      'strikeout',
      'square',
      'circle',
      'line',
      'polygon',
      'polyline',
      'freeText',
      'text',
      'stamp',
      'caret',
    ]) {
      expect(pdfAnnotationSubtypeFromName(name)).toBe(name);
    }
  });

  it('folds widgets, links, popups and unknown names to "unknown"', () => {
    expect(pdfAnnotationSubtypeFromName('widget')).toBe('unknown');
    expect(pdfAnnotationSubtypeFromName('link')).toBe('unknown');
    expect(pdfAnnotationSubtypeFromName('popup')).toBe('unknown');
    expect(pdfAnnotationSubtypeFromName('')).toBe('unknown');
    expect(pdfAnnotationSubtypeFromName('Highlight')).toBe('unknown'); // case-sensitive (wire is lowercased)
  });
});

describe('PdfAnnotationFlag', () => {
  it('exposes the FPDF_ANNOT_FLAG_* bit masks', () => {
    expect(PdfAnnotationFlag.invisible).toBe(1);
    expect(PdfAnnotationFlag.hidden).toBe(2);
    expect(PdfAnnotationFlag.print).toBe(4);
    expect(PdfAnnotationFlag.noView).toBe(32);
    expect(PdfAnnotationFlag.readOnly).toBe(64);
    expect(PdfAnnotationFlag.locked).toBe(128);
  });

  it('composes and tests independently with bitwise AND', () => {
    const flags = PdfAnnotationFlag.print | PdfAnnotationFlag.locked;
    expect(flags & PdfAnnotationFlag.print).toBeTruthy();
    expect(flags & PdfAnnotationFlag.locked).toBeTruthy();
    expect(flags & PdfAnnotationFlag.hidden).toBeFalsy();
  });
});

describe('annotation snapshot serialization', () => {
  it('round-trips stable ids, collaboration metadata and binary appearance data', () => {
    const snapshot: PdfAnnotationSnapshot = {
      version: 1,
      annotations: [{
        id: 'annotation-1',
        pageNumber: 2,
        spec: {
          id: 'annotation-1',
          subtype: 'freeText',
          actorId: 'user-42',
          revision: 7,
          appearanceRuns: [[{
            text: '日本語',
            fontFace: null,
            x: 0,
            image: { width: 1, height: 1, scale: 1, pixels: new Uint8Array([1, 2, 255]) },
          }]],
        },
      }],
    };

    const restored = deserializeAnnotationSnapshot(serializeAnnotationSnapshot(snapshot));
    expect(restored).toEqual(snapshot);
    expect(restored.annotations[0]?.spec.appearanceRuns?.[0]?.[0]?.image?.pixels).toBeInstanceOf(Uint8Array);
  });
});
