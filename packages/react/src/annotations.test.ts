import { pdfAnnotationSubtypeFromName, PdfAnnotationFlag } from '@pdfrx/engine';
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
