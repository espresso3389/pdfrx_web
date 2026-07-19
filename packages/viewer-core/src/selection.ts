/**
 * Text selection core — port of the selection logic in
 * `pdfrx/lib/src/widgets/pdf_viewer.dart` (`_findTextAndIndexForPoint`,
 * `_updateTextSelection`, `selectWord`, `PdfTextSelectionPoint`,
 * `PdfTextSelectionRange`, `PdfTextSelectionAnchor`).
 *
 * Everything here is pure: pointer geometry in, selection state out. The
 * caller (the viewer shell) owns pointer capture, page-text loading, and
 * painting.
 */

import {
  offsetToPdfPoint,
  pdfPointToOffsetInDocument,
  pdfRectContainsPoint,
  pdfRectDistanceSquaredTo,
  pdfRectToRectInDocument,
  rectContains,
  rectSize,
  type Offset,
  type PageGeometry,
  type Rect,
} from './geometry.js';
import {
  fragmentEnd,
  getFragmentForTextIndex,
  getRangeFromAB,
  rangeFirstFragment,
  rangeLastFragment,
  type PdfPageText,
  type PdfTextDirection,
} from './text.js';

/** A (page text, character index) pair; both selection ends are inclusive. */
export interface SelectionPoint {
  text: PdfPageText;
  index: number;
}

/** Whether the point references an existing character on its page. */
export const selectionPointIsValid = (p: SelectionPoint): boolean =>
  p.index >= 0 && p.index < p.text.charRects.length;

/** `PdfTextSelectionPoint.operator <=` — ordered by (pageNumber, index). */
export const selectionPointLE = (a: SelectionPoint, b: SelectionPoint): boolean =>
  a.text.pageNumber !== b.text.pageNumber ? a.text.pageNumber < b.text.pageNumber : a.index <= b.index;

/** `PdfTextSelectionPoint.operator <` — strict ordering by (pageNumber, index). */
export const selectionPointLT = (a: SelectionPoint, b: SelectionPoint): boolean =>
  a.text.pageNumber !== b.text.pageNumber ? a.text.pageNumber < b.text.pageNumber : a.index < b.index;

/** Which end of the selection an anchor is: `a` is the start, `b` the end. */
export type SelectionAnchorType = 'a' | 'b';

/** Port of `PdfTextSelectionAnchor`. `rect` is in document coordinates. */
export interface SelectionAnchor {
  rect: Rect;
  direction: PdfTextDirection;
  type: SelectionAnchorType;
  page: PdfPageText;
  /** Inclusive character index (see the Dart doc comment for the A/B convention). */
  index: number;
}

/** `PdfTextSelectionAnchor.anchorPoint` — the apex of the rect for handle placement. */
export function anchorPoint(anchor: SelectionAnchor): Offset {
  const { rect, direction, type } = anchor;
  switch (direction) {
    case 'ltr':
    case 'unknown':
      return type === 'a' ? { x: rect.left, y: rect.top } : { x: rect.right, y: rect.bottom };
    case 'rtl':
    case 'vrtl':
      return type === 'a' ? { x: rect.right, y: rect.top } : { x: rect.left, y: rect.bottom };
  }
}

/**
 * What a page contributes to selection geometry: its geometry, laid-out rect,
 * and (if already loaded) its structured text. Pages whose text is not loaded
 * yet simply cannot be hit.
 */
export interface SelectablePage {
  page: PageGeometry;
  pageRect: Rect;
  text: PdfPageText | null;
}

/**
 * `_findTextAndIndexForPoint` — find the character nearest to a document
 * position. Exact hits win; otherwise the closest character within
 * `hitTestMargin` (document units) is used.
 */
export function findTextAndIndexForPoint(
  point: Offset,
  pages: readonly SelectablePage[],
  hitTestMargin = 8,
): SelectionPoint | null {
  for (const { page, pageRect, text } of pages) {
    if (!rectContains(pageRect, point)) continue;
    if (!text) continue;
    const pt = offsetToPdfPoint(
      { x: point.x - pageRect.left, y: point.y - pageRect.top },
      { page, scaledPageSize: rectSize(pageRect) },
    );
    let d2Min = Infinity;
    let closestIndex: number | null = null;
    for (let i = 0; i < text.charRects.length; i++) {
      const charRect = text.charRects[i]!;
      if (pdfRectContainsPoint(charRect, pt)) {
        return { text, index: i };
      }
      const d2 = pdfRectDistanceSquaredTo(charRect, pt);
      if (d2 < d2Min) {
        d2Min = d2;
        closestIndex = i;
      }
    }
    if (closestIndex !== null && d2Min <= hitTestMargin * hitTestMargin) {
      return { text, index: closestIndex };
    }
  }
  return null;
}

/** The A (start) and B (end) anchors of a selection; see {@link SelectionAnchor}. */
export interface SelectionAnchors {
  a: SelectionAnchor;
  b: SelectionAnchor;
}

/** Page lookup used when computing anchors: 1-based page number -> geometry. */
export type PageGeometryResolver = (pageNumber: number) => { page: PageGeometry; pageRect: Rect };

/**
 * `_updateTextSelection` — compute the A/B anchors for the current selection
 * ends. Handles both same-page and cross-page selections.
 */
export function computeSelectionAnchors(
  selA: SelectionPoint,
  selB: SelectionPoint,
  resolvePage: PageGeometryResolver,
): SelectionAnchors {
  if (selA.text.pageNumber === selB.text.pageNumber) {
    const { page, pageRect } = resolvePage(selA.text.pageNumber);
    const range = getRangeFromAB(selA.text, selA.index, selB.index);
    return {
      a: {
        rect: pdfRectToRectInDocument(selA.text.charRects[range.start]!, page, pageRect),
        direction: rangeFirstFragment(range)?.direction ?? 'ltr',
        type: 'a',
        page: selA.text,
        index: selA.index,
      },
      b: {
        rect: pdfRectToRectInDocument(selA.text.charRects[range.end - 1]!, page, pageRect),
        direction: rangeLastFragment(range)?.direction ?? 'ltr',
        type: 'b',
        page: selA.text,
        index: selB.index,
      },
    };
  }

  const first = selA.text.pageNumber < selB.text.pageNumber ? selA : selB;
  const second = selA.text.pageNumber < selB.text.pageNumber ? selB : selA;
  const firstGeom = resolvePage(first.text.pageNumber);
  const secondGeom = resolvePage(second.text.pageNumber);
  const rangeA = { pageText: first.text, start: first.index, end: first.text.charRects.length };
  const rangeB = { pageText: second.text, start: 0, end: second.index + 1 };
  return {
    a: {
      rect: pdfRectToRectInDocument(first.text.charRects[first.index]!, firstGeom.page, firstGeom.pageRect),
      direction: rangeFirstFragment(rangeA)?.direction ?? 'ltr',
      type: 'a',
      page: first.text,
      index: first.index,
    },
    b: {
      rect: pdfRectToRectInDocument(second.text.charRects[second.index]!, secondGeom.page, secondGeom.pageRect),
      direction: rangeLastFragment(rangeB)?.direction ?? 'ltr',
      type: 'b',
      page: second.text,
      index: second.index,
    },
  };
}

/** Result of a word (fragment) selection: the two selection ends plus their anchors. */
export interface WordSelection {
  /** Start of the selected word (inclusive). */
  selA: SelectionPoint;
  /** End of the selected word (inclusive). */
  selB: SelectionPoint;
  /** A/B anchors for handle placement and highlight painting. */
  anchors: SelectionAnchors;
}

/**
 * `selectWord` (the geometry part) — select the fragment (word) under the
 * given document position, if any.
 */
export function selectWordAt(point: Offset, pages: readonly SelectablePage[]): WordSelection | null {
  for (const { page, pageRect, text } of pages) {
    if (!rectContains(pageRect, point)) continue;
    if (!text || text.fullText.length === 0) continue;

    const pt = offsetToPdfPoint(
      { x: point.x - pageRect.left, y: point.y - pageRect.top },
      { page, scaledPageSize: rectSize(pageRect) },
    );
    const f = text.fragments.find((f) => pdfRectContainsPoint(f.bounds, pt));
    if (!f) continue;

    const selectionRect = pdfRectToRectInDocument(f.bounds, page, pageRect);
    const direction = getFragmentForTextIndex(text, f.index)?.direction ?? 'ltr';
    const selA: SelectionPoint = { text, index: f.index };
    const selB: SelectionPoint = { text, index: fragmentEnd(f) - 1 };
    const a: SelectionAnchor = { rect: selectionRect, direction, type: 'a', page: text, index: selA.index };
    return {
      selA,
      selB,
      anchors: { a, b: { ...a, type: 'b', index: selB.index } },
    };
  }
  return null;
}

/**
 * Expand a selection spanning multiple pages into per-page ranges
 * (used for highlight painting and text extraction).
 *
 * `getText` resolves loaded page texts by 1-based page number; unloaded pages
 * between the endpoints are skipped.
 */
export function getSelectedRanges(
  selA: SelectionPoint,
  selB: SelectionPoint,
  getText: (pageNumber: number) => PdfPageText | null,
): { pageText: PdfPageText; start: number; end: number }[] {
  const first = selectionPointLE(selA, selB) ? selA : selB;
  const last = selectionPointLE(selA, selB) ? selB : selA;

  if (first.text.pageNumber === last.text.pageNumber) {
    const range = getRangeFromAB(first.text, first.index, last.index);
    return [{ pageText: range.pageText, start: range.start, end: range.end }];
  }

  const ranges: { pageText: PdfPageText; start: number; end: number }[] = [];
  ranges.push({ pageText: first.text, start: first.index, end: first.text.charRects.length });
  for (let pageNumber = first.text.pageNumber + 1; pageNumber < last.text.pageNumber; pageNumber++) {
    const text = getText(pageNumber);
    if (text && text.fullText.length > 0) {
      ranges.push({ pageText: text, start: 0, end: text.charRects.length });
    }
  }
  ranges.push({ pageText: last.text, start: 0, end: last.index + 1 });
  return ranges;
}

/** Compose the plain text of the given ranges (for clipboard). */
export function composeSelectedText(ranges: readonly { pageText: PdfPageText; start: number; end: number }[]): string {
  return ranges.map((r) => r.pageText.fullText.substring(r.start, r.end)).join('\n');
}
