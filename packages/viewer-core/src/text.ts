/**
 * Structured page text model — port of `pdfrx_engine/lib/src/pdf_text.dart`.
 *
 * `PdfPageText` is a plain object; the Dart getters become functions taking
 * the owning objects explicitly, so everything stays JSON-serializable for
 * test vectors.
 */

import { pdfRectBoundingRect, type PdfRect } from './geometry.js';

/**
 * Reading direction of a text fragment/line. `vrtl` is vertical
 * right-to-left (CJK vertical writing); `unknown` when it cannot be inferred
 * (e.g. a single-character line). Port of `PdfTextDirection`.
 */
export type PdfTextDirection = 'ltr' | 'rtl' | 'vrtl' | 'unknown';

/**
 * A contiguous run of characters sharing one reading direction — a word, a
 * space, or a line break. Port of `PdfPageTextFragment`.
 */
export interface PdfPageTextFragment {
  /** Fragment's start index on `PdfPageText.fullText`. */
  index: number;
  /** Length of the fragment in UTF-16 code units. */
  length: number;
  /** Bounds of the fragment in PDF page coordinates. */
  bounds: PdfRect;
  direction: PdfTextDirection;
}

/**
 * The formatted, selection-ready text of a single page. Port of
 * `PdfPageText`. Char rects are in PDF page coordinates (points, y-up).
 */
export interface PdfPageText {
  /** 1-based page number. */
  pageNumber: number;
  /** The page's full text with words/spaces/newlines normalized by the formatter. */
  fullText: string;
  /** One rect per UTF-16 code unit of `fullText`, in PDF page coordinates. */
  charRects: PdfRect[];
  /** Fragments tiling `fullText` in order; every character belongs to exactly one. */
  fragments: PdfPageTextFragment[];
}

/** Exclusive end index of `f` on `fullText` (`index + length`). */
export const fragmentEnd = (f: PdfPageTextFragment): number => f.index + f.length;

/** The substring of `text.fullText` covered by fragment `f`. */
export const fragmentText = (text: PdfPageText, f: PdfPageTextFragment): string =>
  text.fullText.substring(f.index, f.index + f.length);

/** The per-character rects covered by fragment `f`. */
export const fragmentCharRects = (text: PdfPageText, f: PdfPageTextFragment): PdfRect[] =>
  text.charRects.slice(f.index, f.index + f.length);

/**
 * `PdfPageText.getFragmentIndexForTextIndex` — binary search for the fragment
 * containing `textIndex`. Returns -1 when out of range and `fragments.length`
 * when `textIndex === fullText.length`.
 */
export function getFragmentIndexForTextIndex(text: PdfPageText, textIndex: number): number {
  const fragments = text.fragments;
  if (textIndex === text.fullText.length) return fragments.length;

  // lowerBound: first index whose fragment.index >= textIndex
  let lo = 0;
  let hi = fragments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (fragments[mid]!.index < textIndex) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const index = lo;

  if (index === fragments.length) {
    const f = fragments[fragments.length - 1];
    if (!f || textIndex >= f.index + f.length) return -1;
    return index - 1;
  }
  const f = fragments[index]!;
  if (textIndex < f.index) return index - 1;
  return index;
}

/** The fragment containing `textIndex`, or `null` when out of range. See {@link getFragmentIndexForTextIndex}. */
export function getFragmentForTextIndex(text: PdfPageText, textIndex: number): PdfPageTextFragment | null {
  const index = getFragmentIndexForTextIndex(text, textIndex);
  if (index < 0 || index >= text.fragments.length) return null;
  return text.fragments[index]!;
}

/** A character range on one page; `start` inclusive, `end` exclusive. Port of `PdfPageTextRange`. */
export interface PdfPageTextRange {
  pageText: PdfPageText;
  start: number;
  end: number;
}

/** The substring covered by the range. */
export const rangeText = (r: PdfPageTextRange): string => r.pageText.fullText.substring(r.start, r.end);

/** Bounding rect (PDF page coordinates) over all char rects in the range. */
export const rangeBounds = (r: PdfPageTextRange): PdfRect =>
  pdfRectBoundingRect(r.pageText.charRects, r.start, r.end);

/** Index of the fragment containing the range's first character. */
export const rangeFirstFragmentIndex = (r: PdfPageTextRange): number =>
  getFragmentIndexForTextIndex(r.pageText, r.start);

/** Index of the fragment containing the range's last character (`end - 1`). */
export const rangeLastFragmentIndex = (r: PdfPageTextRange): number =>
  getFragmentIndexForTextIndex(r.pageText, r.end - 1);

/** The fragment containing the range's first character, or `null` if out of range. */
export const rangeFirstFragment = (r: PdfPageTextRange): PdfPageTextFragment | null => {
  const i = rangeFirstFragmentIndex(r);
  return i < 0 || i >= r.pageText.fragments.length ? null : r.pageText.fragments[i]!;
};

/** The fragment containing the range's last character, or `null` if out of range. */
export const rangeLastFragment = (r: PdfPageTextRange): PdfPageTextFragment | null => {
  const i = rangeLastFragmentIndex(r);
  return i < 0 || i >= r.pageText.fragments.length ? null : r.pageText.fragments[i]!;
};

/**
 * `PdfPageText.getRangeFromAB` — build a range from two *inclusive* character
 * indices in either order.
 */
export function getRangeFromAB(text: PdfPageText, a: number, b: number): PdfPageTextRange {
  const min = a < b ? a : b;
  const max = a < b ? b : a;
  if (min < 0 || max > text.fullText.length) {
    throw new RangeError(`Indices out of range: ${min}, ${max} for fullText length ${text.fullText.length}.`);
  }
  return { pageText: text, start: min, end: max + 1 };
}

/** Per-fragment bounding rect of a sub-range; port of `PdfTextFragmentBoundingRect`. */
export interface PdfTextFragmentBoundingRect {
  fragment: PdfPageTextFragment;
  /** Start-In-Fragment index. */
  sif: number;
  /** End-In-Fragment index. */
  eif: number;
  /** Rectangle in PDF page coordinates for the sub-range. */
  bounds: PdfRect;
  direction: PdfTextDirection;
}

/**
 * `PdfPageTextRange.enumerateFragmentBoundingRects` — the per-fragment rects
 * used to paint the selection highlight.
 */
export function enumerateFragmentBoundingRects(r: PdfPageTextRange): PdfTextFragmentBoundingRect[] {
  const result: PdfTextFragmentBoundingRect[] = [];
  const fStart = rangeFirstFragmentIndex(r);
  const fEnd = rangeLastFragmentIndex(r);
  for (let i = fStart; i <= fEnd; i++) {
    const f = r.pageText.fragments[i];
    if (!f) continue;
    if (fragmentEnd(f) <= r.start || r.end <= f.index) continue;
    const sif = Math.max(r.start - f.index, 0);
    const eif = Math.min(r.end - f.index, f.length);
    result.push({
      fragment: f,
      sif,
      eif,
      bounds: pdfRectBoundingRect(r.pageText.charRects, f.index + sif, f.index + eif),
      direction: f.direction,
    });
  }
  return result;
}

/** `PdfPageText.allMatches` — find all matches of a pattern on the page. */
export function allMatches(
  text: PdfPageText,
  pattern: string | RegExp,
  options: { caseInsensitive?: boolean } = {},
): PdfPageTextRange[] {
  const results: PdfPageTextRange[] = [];
  let re: RegExp;
  if (pattern instanceof RegExp) {
    re = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
  } else {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(escaped, (options.caseInsensitive ?? true) ? 'gi' : 'g');
  }
  for (const match of text.fullText.matchAll(re)) {
    if (match[0].length === 0) continue;
    results.push({ pageText: text, start: match.index, end: match.index + match[0].length });
  }
  return results;
}
