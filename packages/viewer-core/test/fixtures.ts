/**
 * Shared synthetic fixtures for selection/text tests.
 *
 * The geometry is designed to be easy to reason about and is intended to be
 * mirrored as test vectors on the Dart side:
 *
 * - Page: 200x100 pt, rotation 0, laid out 1:1 at a given document offset.
 * - Text: "Hello world" on one line; every char box is 10x10 pt,
 *   starting at PDF x=10, line top at PDF y=80 (i.e. document y=20).
 */

import type { PageGeometry, PdfRect, Rect } from '../src/index.js';
import type { PdfPageText } from '../src/index.js';

export const page: PageGeometry = { width: 200, height: 100, rotation: 0 };

export const LINE_TOP = 80;
export const LINE_BOTTOM = 70;
export const CHAR_WIDTH = 10;
export const TEXT_LEFT = 10;

export function makeCharRects(count: number): PdfRect[] {
  const rects: PdfRect[] = [];
  for (let i = 0; i < count; i++) {
    rects.push({
      left: TEXT_LEFT + i * CHAR_WIDTH,
      top: LINE_TOP,
      right: TEXT_LEFT + (i + 1) * CHAR_WIDTH,
      bottom: LINE_BOTTOM,
    });
  }
  return rects;
}

/** "Hello world" with fragments [Hello][ ][world], all LTR. */
export function makeHelloWorldText(pageNumber = 1): PdfPageText {
  const fullText = 'Hello world';
  const charRects = makeCharRects(fullText.length);
  const bounds = (start: number, end: number): PdfRect => ({
    left: charRects[start]!.left,
    top: LINE_TOP,
    right: charRects[end - 1]!.right,
    bottom: LINE_BOTTOM,
  });
  return {
    pageNumber,
    fullText,
    charRects,
    fragments: [
      { index: 0, length: 5, bounds: bounds(0, 5), direction: 'ltr' },
      { index: 5, length: 1, bounds: bounds(5, 6), direction: 'ltr' },
      { index: 6, length: 5, bounds: bounds(6, 11), direction: 'ltr' },
    ],
  };
}

/** Page laid out 1:1 at (0, 0) in document coordinates. */
export const pageRectAtOrigin: Rect = { left: 0, top: 0, right: 200, bottom: 100 };

/** Second page laid out below the first with a 10pt gap. */
export const pageRectSecond: Rect = { left: 0, top: 110, right: 200, bottom: 210 };
