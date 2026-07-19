/**
 * Text flow analysis and fragment building — port of
 * `pdfrx_engine/lib/src/pdf_text_formatter.dart`.
 *
 * Takes the raw page text from the engine (`fullText` + one rect per char)
 * and produces a `PdfPageText` with direction-aware fragments (words, spaces,
 * line breaks), which is what the selection logic operates on.
 */

import { pdfRectBoundingRect, pdfRectCenter, pdfRectIsEmpty, type PdfRect } from './geometry.js';
import type { PdfPageText, PdfPageTextFragment, PdfTextDirection } from './text.js';

/**
 * Raw per-page text as returned by the engine, before flow analysis: the
 * concatenated character stream plus one rect (PDF page coordinates) per
 * UTF-16 code unit. Input to {@link formatText}.
 */
export interface RawPageText {
  fullText: string;
  /** One rect per UTF-16 code unit of `fullText`, in PDF page coordinates (y-up). */
  charRects: PdfRect[];
}

/**
 * Maximum extent of a combined space rect, as a ratio to the line height
 * (or the line width for vertical text). See the Dart source for rationale
 * (PDFium generates zero-width spaces for large gaps, e.g. table columns).
 */
const MAX_SPACE_EXTENT_TO_LINE_HEIGHT_RATIO = 1.5;

/** Maximum extent of a *generated* (point-box) space rect. */
const GENERATED_SPACE_EXTENT_TO_LINE_HEIGHT_RATIO = 0.25;

const RE_SPACES = /(\s+)/gu;
const RE_NEW_LINE = /\r?\n/gu;

interface Vec2 {
  x: number;
  y: number;
}

const vecAdd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

const vecAngleTo = (a: Vec2, b: Vec2): number => {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (la * lb)));
  return Math.acos(cos);
};

const centerDiff = (from: PdfRect, to: PdfRect): Vec2 => {
  const a = pdfRectCenter(from);
  const b = pdfRectCenter(to);
  return { x: b.x - a.x, y: b.y - a.y };
};

/** `loadStructuredText` (the pure part; the raw text is supplied by the caller). */
export function formatText(raw: RawPageText, pageNumber: number): PdfPageText {
  const preprocessed = removeVirtualNewLines(raw);
  const inputFullText = preprocessed.fullText;
  const inputCharRects = preprocessed.charRects;

  if (inputFullText.length === 0) {
    return { pageNumber, fullText: '', charRects: [], fragments: [] };
  }

  const fragmentsTmp: { length: number; direction: PdfTextDirection }[] = [];
  let outputText = '';
  const outputCharRects: PdfRect[] = [];

  const vector2direction = (v: Vec2): PdfTextDirection => {
    if (Math.abs(v.x) > Math.abs(v.y)) {
      return v.x > 0 ? 'ltr' : 'rtl';
    }
    return 'vrtl';
  };

  const getLineDirection = (start: number, end: number): PdfTextDirection => {
    if (start === end || start + 1 === end) return 'unknown';
    return vector2direction(centerDiff(inputCharRects[start]!, inputCharRects[end - 1]!));
  };

  const addWord = (
    wordStart: number,
    wordEnd: number,
    dir: PdfTextDirection,
    bounds: PdfRect,
    opts: { isSpace?: boolean; isNewLine?: boolean } = {},
  ): void => {
    if (wordStart >= wordEnd) return;
    const pos = outputText.length;
    if (opts.isSpace) {
      if (wordStart > 0 && wordEnd < inputCharRects.length) {
        // combine several spaces into one space
        const a = inputCharRects[wordStart - 1]!;
        const b = inputCharRects[wordEnd]!;
        // Clamp the space extent so a generated space representing a large gap
        // does not become one huge selectable rect (see Dart source).
        let isGeneratedGap = true;
        for (let i = wordStart; i < wordEnd; i++) {
          const r = inputCharRects[i]!;
          if (r.right - r.left > 0 || r.top - r.bottom > 0) {
            isGeneratedGap = false;
            break;
          }
        }
        const extentRatio = isGeneratedGap
          ? GENERATED_SPACE_EXTENT_TO_LINE_HEIGHT_RATIO
          : MAX_SPACE_EXTENT_TO_LINE_HEIGHT_RATIO;
        switch (dir) {
          case 'ltr':
          case 'unknown': {
            const maxExtent = (bounds.top - bounds.bottom) * extentRatio;
            const right = a.right < b.left ? b.left : a.right;
            outputCharRects.push({
              left: a.right,
              top: bounds.top,
              right: Math.min(right, a.right + maxExtent),
              bottom: bounds.bottom,
            });
            break;
          }
          case 'rtl': {
            const maxExtent = (bounds.top - bounds.bottom) * extentRatio;
            const right = b.right < a.left ? a.left : b.right;
            outputCharRects.push({
              left: Math.max(b.right, right - maxExtent),
              top: bounds.top,
              right,
              bottom: bounds.bottom,
            });
            break;
          }
          case 'vrtl': {
            const maxExtent = (bounds.right - bounds.left) * extentRatio;
            const bottom = a.bottom > b.top ? b.top : a.bottom;
            outputCharRects.push({
              left: bounds.left,
              top: a.bottom,
              right: bounds.right,
              bottom: Math.max(bottom, a.bottom - maxExtent),
            });
            break;
          }
        }
        outputText += ' ';
      }
    } else if (opts.isNewLine) {
      if (wordStart > 0) {
        switch (dir) {
          case 'ltr':
          case 'unknown':
            outputCharRects.push({ left: bounds.right, top: bounds.top, right: bounds.right, bottom: bounds.bottom });
            break;
          case 'rtl':
            outputCharRects.push({ left: bounds.left, top: bounds.top, right: bounds.left, bottom: bounds.bottom });
            break;
          case 'vrtl':
            outputCharRects.push({
              left: bounds.left,
              top: bounds.bottom,
              right: bounds.right,
              bottom: bounds.bottom,
            });
            break;
        }
        outputText += '\n';
      }
    } else {
      // Adjust character bounding boxes based on text direction.
      switch (dir) {
        case 'ltr':
        case 'rtl':
        case 'unknown':
          for (let i = wordStart; i < wordEnd; i++) {
            const r = inputCharRects[i]!;
            outputCharRects.push({ left: r.left, top: bounds.top, right: r.right, bottom: bounds.bottom });
          }
          break;
        case 'vrtl':
          for (let i = wordStart; i < wordEnd; i++) {
            const r = inputCharRects[i]!;
            outputCharRects.push({ left: bounds.left, top: r.top, right: bounds.right, bottom: r.bottom });
          }
          break;
      }
      outputText += inputFullText.substring(wordStart, wordEnd);
    }
    if (outputText.length > pos) {
      fragmentsTmp.push({ length: outputText.length - pos, direction: dir });
    }
  };

  const addWords = (start: number, end: number, dir: PdfTextDirection, bounds: PdfRect): void => {
    RE_SPACES.lastIndex = 0;
    let wordStart = start;
    for (const match of inputFullText.substring(start, end).matchAll(RE_SPACES)) {
      const spaceStart = start + match.index;
      addWord(wordStart, spaceStart, dir, bounds);
      wordStart = start + match.index + match[0].length;
      addWord(spaceStart, wordStart, dir, bounds, { isSpace: true });
    }
    addWord(wordStart, end, dir, bounds);
  };

  const charVec = (index: number, prev: Vec2): Vec2 => {
    if (index + 1 >= inputCharRects.length) return prev;
    const next = inputCharRects[index + 1]!;
    if (pdfRectIsEmpty(next)) return prev;
    return centerDiff(inputCharRects[index]!, next);
  };

  const splitLine = (start: number, end: number): { start: number; end: number; dir: PdfTextDirection }[] => {
    const list: { start: number; end: number; dir: PdfTextDirection }[] = [];
    const lineThreshold = 1.5; // radians
    const last = end - 1;
    let curStart = start;
    let curVec = charVec(start, { x: 1, y: 0 });
    for (let next = start + 1; next < last; ) {
      const nextVec = charVec(next, curVec);
      if (vecAngleTo(curVec, nextVec) > lineThreshold) {
        list.push({ start: curStart, end: next + 1, dir: vector2direction(curVec) });
        curStart = next + 1;
        if (next + 2 === end) break;
        curVec = charVec(next + 1, nextVec);
        next += 2;
        continue;
      }
      curVec = vecAdd(curVec, nextVec);
      next++;
    }
    if (curStart < end) {
      list.push({ start: curStart, end, dir: vector2direction(curVec) });
    }
    return list;
  };

  const handleLine = (start: number, end: number, newLineEnd?: number): void => {
    const dir = getLineDirection(start, end);
    const segments = splitLine(start, end);
    if (segments.length >= 2) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const bounds = pdfRectBoundingRect(inputCharRects, seg.start, seg.end);
        addWords(seg.start, seg.end, seg.dir, bounds);
        if (i + 1 === segments.length && newLineEnd !== undefined) {
          addWord(seg.end, newLineEnd, seg.dir, bounds, { isNewLine: true });
        }
      }
    } else {
      const bounds = pdfRectBoundingRect(inputCharRects, start, end);
      addWords(start, end, dir, bounds);
      if (newLineEnd !== undefined) {
        addWord(end, newLineEnd, dir, bounds, { isNewLine: true });
      }
    }
  };

  let lineStart = 0;
  RE_NEW_LINE.lastIndex = 0;
  for (const match of inputFullText.matchAll(RE_NEW_LINE)) {
    if (lineStart < match.index) {
      handleLine(lineStart, match.index, match.index + match[0].length);
    } else if (outputCharRects.length > 0) {
      const lastRect = outputCharRects[outputCharRects.length - 1]!;
      outputCharRects.push({ left: lastRect.left, top: lastRect.top, right: lastRect.left, bottom: lastRect.bottom });
      outputText += '\n';
    }
    lineStart = match.index + match[0].length;
  }
  if (lineStart < inputFullText.length) {
    handleLine(lineStart, inputFullText.length);
  }

  const fragments: PdfPageTextFragment[] = [];
  let start = 0;
  for (const { length, direction } of fragmentsTmp) {
    const end = start + length;
    fragments.push({
      index: start,
      length,
      bounds: pdfRectBoundingRect(outputCharRects, start, end),
      direction,
    });
    start = end;
  }

  return { pageNumber, fullText: outputText, charRects: outputCharRects, fragments };
}

/**
 * `_loadFormattedText` post-processing: removes "virtual" line feeds that
 * some producers (e.g. Microsoft Word) insert between the characters of
 * vertical text runs.
 */
export function removeVirtualNewLines(input: RawPageText): RawPageText {
  let fullText = '';
  const charRects: PdfRect[] = [];

  RE_NEW_LINE.lastIndex = 0;
  const lnMatches = [...input.fullText.matchAll(RE_NEW_LINE)];
  let lineStart = 0;
  let prevEnd = 0;
  for (let i = 0; i < lnMatches.length; i++) {
    lineStart = prevEnd;
    const match = lnMatches[i]!;
    fullText += input.fullText.substring(lineStart, match.index);
    charRects.push(...input.charRects.slice(lineStart, match.index));
    prevEnd = match.index + match[0].length;

    if (i + 1 < lnMatches.length) {
      const next = lnMatches[i + 1]!;
      const len = match.index - lineStart;
      const nextLen = next.index - prevEnd;
      if (len === 1 && nextLen === 1) {
        const rect = input.charRects[lineStart]!;
        const nextRect = input.charRects[prevEnd]!;
        const nextCenterX = (nextRect.left + nextRect.right) / 2;
        if (rect.left < nextCenterX && nextCenterX < rect.right && rect.top > nextRect.top) {
          // The line is vertical, and the line-feed is virtual
          continue;
        }
      }
    }
    fullText += input.fullText.substring(match.index, prevEnd);
    charRects.push(...input.charRects.slice(match.index, prevEnd));
  }
  if (prevEnd < input.fullText.length) {
    fullText += input.fullText.substring(prevEnd);
    charRects.push(...input.charRects.slice(prevEnd));
  }

  return { fullText, charRects };
}
