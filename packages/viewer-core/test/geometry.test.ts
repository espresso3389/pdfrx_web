import { describe, expect, it } from 'vitest';
import {
  offsetToPdfPoint,
  offsetDeltaToPdfDelta,
  pdfPointRotate,
  pdfPointRotateReverse,
  pdfPointToOffsetInDocument,
  pdfRectRotate,
  pdfRectRotateReverse,
  pdfRectToRect,
  pdfRectToRectInDocument,
  rectToPdfRect,
  type PageGeometry,
  type PdfRect,
} from '../src/index.js';

const pageA4: PageGeometry = { width: 595, height: 842, rotation: 0 };
const pageA4Rotated: PageGeometry = { width: 842, height: 595, rotation: 1 };

describe('rotation round-trips', () => {
  const rect: PdfRect = { left: 10, top: 40, right: 30, bottom: 20 };
  const point = { x: 12, y: 34 };

  for (const page of [pageA4, pageA4Rotated]) {
    for (let rotation = 0; rotation < 4; rotation++) {
      it(`rect rotate(${rotation}) then rotateReverse on page rotation ${page.rotation}`, () => {
        const rotated = pdfRectRotate(rect, rotation, page);
        expect(pdfRectRotateReverse(rotated, rotation, page)).toEqual(rect);
        // Rect invariant: top >= bottom, right >= left
        expect(rotated.top).toBeGreaterThanOrEqual(rotated.bottom);
        expect(rotated.right).toBeGreaterThanOrEqual(rotated.left);
      });
      it(`point rotate(${rotation}) then rotateReverse on page rotation ${page.rotation}`, () => {
        expect(pdfPointRotateReverse(pdfPointRotate(point, rotation, page), rotation, page)).toEqual(point);
      });
    }
  }
});

describe('PDF <-> view space conversions', () => {
  const page: PageGeometry = { width: 200, height: 100, rotation: 0 };

  it('pdfRectToRect flips the y-axis', () => {
    // PDF: left=10, top=80 (y-up), right=30, bottom=60
    const r: PdfRect = { left: 10, top: 80, right: 30, bottom: 60 };
    expect(pdfRectToRect(r, { page })).toEqual({ left: 10, top: 20, right: 30, bottom: 40 });
  });

  it('pdfRectToRect applies scaledPageSize', () => {
    const r: PdfRect = { left: 10, top: 80, right: 30, bottom: 60 };
    // 2x scale
    expect(pdfRectToRect(r, { page, scaledPageSize: { width: 400, height: 200 } })).toEqual({
      left: 20,
      top: 40,
      right: 60,
      bottom: 80,
    });
  });

  it('rectToPdfRect is the inverse of pdfRectToRect', () => {
    const r: PdfRect = { left: 10, top: 80, right: 30, bottom: 60 };
    const viewRect = pdfRectToRect(r, { page, scaledPageSize: { width: 400, height: 200 } });
    expect(rectToPdfRect(viewRect, { page, scaledPageSize: { width: 400, height: 200 } })).toEqual(r);
  });

  it('pdfRectToRectInDocument translates by the page layout rect', () => {
    const r: PdfRect = { left: 10, top: 80, right: 30, bottom: 60 };
    const pageRect = { left: 100, top: 500, right: 300, bottom: 600 }; // 200x100 at (100, 500)
    expect(pdfRectToRectInDocument(r, page, pageRect)).toEqual({ left: 110, top: 520, right: 130, bottom: 540 });
  });

  it('offsetToPdfPoint round-trips with pdfPointToOffsetInDocument', () => {
    const pageRect = { left: 100, top: 500, right: 300, bottom: 600 };
    const pdfPoint = { x: 55, y: 33 };
    const doc = pdfPointToOffsetInDocument(pdfPoint, page, pageRect);
    const back = offsetToPdfPoint(
      { x: doc.x - pageRect.left, y: doc.y - pageRect.top },
      { page, scaledPageSize: { width: 200, height: 100 } },
    );
    expect(back.x).toBeCloseTo(pdfPoint.x, 10);
    expect(back.y).toBeCloseTo(pdfPoint.y, 10);
  });

  it('handles rotated pages (rotation=1)', () => {
    const rotatedPage: PageGeometry = { width: 100, height: 200, rotation: 1 }; // visual 100x200, raw 200x100
    const r: PdfRect = { left: 10, top: 80, right: 30, bottom: 60 };
    const viewRect = pdfRectToRect(r, { page: rotatedPage });
    const back = rectToPdfRect(viewRect, { page: rotatedPage });
    expect(back).toEqual(r);
  });

  it.each([
    [{ width: 200, height: 100, rotation: 0 }, { x: 10, y: -20 }],
    [{ width: 100, height: 200, rotation: 1 }, { x: 20, y: 10 }],
    [{ width: 200, height: 100, rotation: 2 }, { x: -10, y: 20 }],
    [{ width: 100, height: 200, rotation: 3 }, { x: -20, y: -10 }],
  ] as const)('converts view displacement through page rotation %#', (rotatedPage, expected) => {
    expect(offsetDeltaToPdfDelta({ x: 10, y: 20 }, { page: rotatedPage })).toEqual(expected);
  });
});
