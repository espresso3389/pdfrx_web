import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  composeSelectedText,
  computeSelectionAnchors,
  findTextAndIndexForPoint,
  getSelectedRanges,
  selectWordAt,
  selectionPointLE,
  type SelectablePage,
} from '../src/index.js';
import { makeHelloWorldText, page, pageRectAtOrigin, pageRectSecond } from './fixtures.js';

const text = makeHelloWorldText();
const pages: SelectablePage[] = [{ page, pageRect: pageRectAtOrigin, text }];

// Document y for the text line: page height 100, PDF line top 80 -> doc top 20, bottom 30.

describe('findTextAndIndexForPoint', () => {
  it('hits a character exactly', () => {
    // First char box: doc (10,20)-(20,30)
    const p = findTextAndIndexForPoint({ x: 15, y: 25 }, pages);
    expect(p).not.toBeNull();
    expect(p!.index).toBe(0);
  });

  it('snaps to the nearest character within the margin', () => {
    // 5 units above the line
    const p = findTextAndIndexForPoint({ x: 15, y: 15 }, pages, 8);
    expect(p!.index).toBe(0);
  });

  it('misses beyond the margin', () => {
    expect(findTextAndIndexForPoint({ x: 15, y: 5 }, pages, 8)).toBeNull();
  });

  it('misses outside the page', () => {
    expect(findTextAndIndexForPoint({ x: 300, y: 25 }, pages)).toBeNull();
  });

  it('skips pages whose text is not loaded', () => {
    const unloaded: SelectablePage[] = [{ page, pageRect: pageRectAtOrigin, text: null }];
    expect(findTextAndIndexForPoint({ x: 15, y: 25 }, unloaded)).toBeNull();
  });
});

describe('computeSelectionAnchors (same page)', () => {
  it('computes A/B anchors with LTR direction', () => {
    const anchors = computeSelectionAnchors({ text, index: 0 }, { text, index: 10 }, () => ({
      page,
      pageRect: pageRectAtOrigin,
    }));
    expect(anchors.a.rect).toEqual({ left: 10, top: 20, right: 20, bottom: 30 });
    expect(anchors.b.rect).toEqual({ left: 110, top: 20, right: 120, bottom: 30 });
    expect(anchors.a.direction).toBe('ltr');
    // LTR: anchor A at top-left, anchor B at bottom-right
    expect(anchorPoint(anchors.a)).toEqual({ x: 10, y: 20 });
    expect(anchorPoint(anchors.b)).toEqual({ x: 120, y: 30 });
  });

  it('normalizes reversed A/B for the rects but keeps the indices', () => {
    const anchors = computeSelectionAnchors({ text, index: 10 }, { text, index: 0 }, () => ({
      page,
      pageRect: pageRectAtOrigin,
    }));
    // Anchor rects follow the normalized range (start char / end char)
    expect(anchors.a.rect).toEqual({ left: 10, top: 20, right: 20, bottom: 30 });
    expect(anchors.b.rect).toEqual({ left: 110, top: 20, right: 120, bottom: 30 });
    // Indices reflect the caller's A/B assignment
    expect(anchors.a.index).toBe(10);
    expect(anchors.b.index).toBe(0);
  });
});

describe('computeSelectionAnchors (cross page)', () => {
  const text2 = makeHelloWorldText(2);

  it('anchors span from A page to B page', () => {
    const anchors = computeSelectionAnchors({ text, index: 8 }, { text: text2, index: 3 }, (pageNumber) => ({
      page,
      pageRect: pageNumber === 1 ? pageRectAtOrigin : pageRectSecond,
    }));
    // char 8 on page 1: left = 10 + 8*10 = 90
    expect(anchors.a.rect).toEqual({ left: 90, top: 20, right: 100, bottom: 30 });
    // char 3 on page 2: left = 40, translated by pageRectSecond.top = 110
    expect(anchors.b.rect).toEqual({ left: 40, top: 130, right: 50, bottom: 140 });
  });
});

describe('selectWordAt', () => {
  it('selects the fragment under the point', () => {
    // "world": chars 6..10, doc x 70..120
    const sel = selectWordAt({ x: 75, y: 25 }, pages);
    expect(sel).not.toBeNull();
    expect(sel!.selA.index).toBe(6);
    expect(sel!.selB.index).toBe(10);
    // The anchor rect is the whole fragment bounds
    expect(sel!.anchors.a.rect).toEqual({ left: 70, top: 20, right: 120, bottom: 30 });
  });

  it('returns null over the background', () => {
    expect(selectWordAt({ x: 15, y: 60 }, pages)).toBeNull();
  });
});

describe('getSelectedRanges / composeSelectedText', () => {
  const text2 = makeHelloWorldText(2);

  it('single page selection', () => {
    const ranges = getSelectedRanges({ text, index: 6 }, { text, index: 10 }, () => null);
    expect(ranges).toHaveLength(1);
    expect(composeSelectedText(ranges)).toBe('world');
  });

  it('cross-page selection includes both endpoints and skips unloaded middles', () => {
    const text3 = makeHelloWorldText(3);
    const ranges = getSelectedRanges({ text, index: 6 }, { text: text3, index: 4 }, (n) =>
      n === 2 ? text2 : null,
    );
    expect(ranges.map((r) => r.pageText.pageNumber)).toEqual([1, 2, 3]);
    expect(composeSelectedText(ranges)).toBe('world\nHello world\nHello');
  });

  it('order-insensitive', () => {
    const a = { text, index: 6 };
    const b = { text, index: 10 };
    expect(selectionPointLE(a, b)).toBe(true);
    expect(composeSelectedText(getSelectedRanges(b, a, () => null))).toBe('world');
  });
});
