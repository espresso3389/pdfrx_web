import { describe, expect, it } from 'vitest';
import {
  allMatches,
  enumerateFragmentBoundingRects,
  getFragmentIndexForTextIndex,
  getRangeFromAB,
  rangeText,
} from '../src/index.js';
import { makeHelloWorldText } from './fixtures.js';

const text = makeHelloWorldText();

describe('getFragmentIndexForTextIndex', () => {
  it('maps character indices to fragments', () => {
    expect(getFragmentIndexForTextIndex(text, 0)).toBe(0);
    expect(getFragmentIndexForTextIndex(text, 4)).toBe(0);
    expect(getFragmentIndexForTextIndex(text, 5)).toBe(1);
    expect(getFragmentIndexForTextIndex(text, 6)).toBe(2);
    expect(getFragmentIndexForTextIndex(text, 10)).toBe(2);
  });

  it('returns fragments.length at the end of text', () => {
    expect(getFragmentIndexForTextIndex(text, text.fullText.length)).toBe(text.fragments.length);
  });

  it('returns -1 out of range', () => {
    expect(getFragmentIndexForTextIndex(text, 100)).toBe(-1);
  });
});

describe('getRangeFromAB', () => {
  it('is inclusive on both ends and order-insensitive', () => {
    const r1 = getRangeFromAB(text, 6, 10);
    expect(rangeText(r1)).toBe('world');
    const r2 = getRangeFromAB(text, 10, 6);
    expect(rangeText(r2)).toBe('world');
  });

  it('throws on out-of-range indices', () => {
    expect(() => getRangeFromAB(text, -1, 5)).toThrow(RangeError);
  });
});

describe('enumerateFragmentBoundingRects', () => {
  it('splits a cross-fragment range at fragment boundaries', () => {
    // "llo wo" = chars 2..8
    const rects = enumerateFragmentBoundingRects({ pageText: text, start: 2, end: 8 });
    expect(rects.map((r) => [r.sif, r.eif])).toEqual([
      [2, 5], // "llo" in fragment 0
      [0, 1], // " " in fragment 1
      [0, 2], // "wo" in fragment 2
    ]);
    // "llo" bounds: chars 2..5 -> left 30, right 60
    expect(rects[0]!.bounds).toEqual({ left: 30, top: 80, right: 60, bottom: 70 });
  });
});

describe('allMatches', () => {
  it('finds case-insensitive string matches', () => {
    const matches = allMatches(text, 'WORLD');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(6);
    expect(matches[0]!.end).toBe(11);
  });

  it('supports RegExp patterns', () => {
    const matches = allMatches(text, /l+/g);
    expect(matches.map((m) => [m.start, m.end])).toEqual([
      [2, 4],
      [9, 10],
    ]);
  });
});
