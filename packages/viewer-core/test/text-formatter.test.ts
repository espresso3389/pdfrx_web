import { describe, expect, it } from 'vitest';
import { formatText, removeVirtualNewLines, type PdfRect, type RawPageText } from '../src/index.js';

const box = (left: number, top: number, right: number, bottom: number): PdfRect => ({ left, top, right, bottom });

/** LTR line: 10x10 boxes from x=10 at line top y=80. */
function ltrLine(textStr: string, y = 80): RawPageText {
  const charRects = [...textStr].map((_, i) => box(10 + i * 10, y, 20 + i * 10, y - 10));
  return { fullText: textStr, charRects };
}

describe('formatText (LTR)', () => {
  it('splits words and spaces into fragments', () => {
    const result = formatText(ltrLine('Hello world'), 1);
    expect(result.fullText).toBe('Hello world');
    expect(result.fragments.map((f) => [f.index, f.length, f.direction])).toEqual([
      [0, 5, 'ltr'],
      [5, 1, 'ltr'],
      [6, 5, 'ltr'],
    ]);
    expect(result.charRects).toHaveLength(11);
  });

  it('normalizes char boxes to the line extent', () => {
    // Give one char a shorter box; its output rect should stretch to the line bounds.
    const raw = ltrLine('ab');
    raw.charRects[1] = box(20, 78, 30, 72);
    const result = formatText(raw, 1);
    expect(result.charRects[1]).toEqual(box(20, 80, 30, 70));
  });

  it('combines the space between words into a single gap rect', () => {
    const result = formatText(ltrLine('a b'), 1);
    // space rect spans from right of 'a' (20) to left of 'b' (30)
    expect(result.charRects[1]).toEqual(box(20, 80, 30, 70));
  });

  it('appends a zero-width newline rect at line ends', () => {
    const raw: RawPageText = {
      fullText: 'ab\ncd',
      charRects: [
        box(10, 80, 20, 70),
        box(20, 80, 30, 70),
        box(30, 80, 30, 70), // newline char box
        box(10, 60, 20, 50),
        box(20, 60, 30, 50),
      ],
    };
    const result = formatText(raw, 1);
    expect(result.fullText).toBe('ab\ncd');
    // Newline rect is zero-width at the line's right edge
    const nl = result.charRects[2]!;
    expect(nl.left).toBe(nl.right);
    expect(nl.left).toBe(30);
  });
});

describe('formatText (RTL)', () => {
  it('detects right-to-left direction', () => {
    const textStr = 'abc';
    const charRects = [...textStr].map((_, i) => box(50 - i * 10, 80, 60 - i * 10, 70));
    const result = formatText({ fullText: textStr, charRects }, 1);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]!.direction).toBe('rtl');
  });
});

describe('formatText (vertical)', () => {
  it('detects vertical direction', () => {
    const textStr = 'あいう';
    const charRects = [...textStr].map((_, i) => box(100, 80 - i * 10, 110, 70 - i * 10));
    const result = formatText({ fullText: textStr, charRects }, 1);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]!.direction).toBe('vrtl');
  });
});

describe('removeVirtualNewLines', () => {
  it('removes line feeds between vertically stacked single characters', () => {
    // "縦\n書\nき\n" vertical layout: each char below the previous one.
    // The trailing \n has no following match to compare against, so it is kept
    // (same behavior as the Dart implementation).
    const raw: RawPageText = {
      fullText: '縦\n書\nき\n',
      charRects: [
        box(100, 80, 110, 70),
        box(110, 70, 110, 70), // newline
        box(100, 68, 110, 58),
        box(110, 58, 110, 58), // newline
        box(100, 56, 110, 46),
        box(110, 46, 110, 46), // newline
      ],
    };
    const result = removeVirtualNewLines(raw);
    expect(result.fullText).toBe('縦書き\n');
    expect(result.charRects).toHaveLength(4);
  });

  it('keeps genuine line feeds', () => {
    const raw: RawPageText = {
      fullText: 'ab\ncd',
      charRects: [
        box(10, 80, 20, 70),
        box(20, 80, 30, 70),
        box(30, 80, 30, 70),
        box(10, 60, 20, 50),
        box(20, 60, 30, 50),
      ],
    };
    const result = removeVirtualNewLines(raw);
    expect(result.fullText).toBe('ab\ncd');
  });
});
