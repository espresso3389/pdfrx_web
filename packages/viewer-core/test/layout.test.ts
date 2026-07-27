import { describe, expect, it } from 'vitest';
import { findPageIndexAt, layoutPagesHorizontal, layoutPagesSpread, layoutPagesVertical } from '../src/index.js';

const pages = [
  { width: 595, height: 842, rotation: 0 },
  { width: 400, height: 842, rotation: 0 },
];

describe('layoutPagesVertical', () => {
  it('stacks pages with margins, centered horizontally', () => {
    const layout = layoutPagesVertical(pages, { margin: 10 });
    // width = max page width + margin*2
    expect(layout.documentSize.width).toBe(615);
    expect(layout.pageLayouts[0]).toEqual({ left: 10, top: 10, right: 605, bottom: 852 });
    // second page centered: (615-400)/2 = 107.5
    expect(layout.pageLayouts[1]).toEqual({ left: 107.5, top: 862, right: 507.5, bottom: 1704 });
    expect(layout.documentSize.height).toBe(1714);
  });
});

describe('layoutPagesHorizontal', () => {
  it('places pages side by side, centered vertically', () => {
    const layout = layoutPagesHorizontal(pages, { margin: 10 });
    expect(layout.documentSize.height).toBe(862);
    expect(layout.pageLayouts[0]).toEqual({ left: 10, top: 10, right: 605, bottom: 852 });
    expect(layout.pageLayouts[1]).toEqual({ left: 615, top: 10, right: 1015, bottom: 852 });
  });
});

describe('layoutPagesSpread', () => {
  const spreadPages = [
    { width: 100, height: 200, rotation: 0 },
    { width: 120, height: 180, rotation: 0 },
    { width: 80, height: 160, rotation: 0 },
  ];

  it('pairs from page one in odd mode', () => {
    const layout = layoutPagesSpread(spreadPages, 'odd', { margin: 10 });
    expect(layout.documentSize).toEqual({ width: 250, height: 390 });
    expect(layout.pageLayouts).toEqual([
      { left: 10, top: 10, right: 110, bottom: 210 },
      { left: 120, top: 10, right: 240, bottom: 190 },
      { left: 85, top: 220, right: 165, bottom: 380 },
    ]);
  });

  it('leaves the cover alone in even mode', () => {
    const layout = layoutPagesSpread(spreadPages, 'even', { margin: 10 });
    expect(layout.documentSize).toEqual({ width: 230, height: 410 });
    expect(layout.pageLayouts).toEqual([
      { left: 65, top: 10, right: 165, bottom: 210 },
      { left: 10, top: 220, right: 130, bottom: 400 },
      { left: 140, top: 220, right: 220, bottom: 380 },
    ]);
  });
});

describe('findPageIndexAt', () => {
  it('finds the page containing a document point', () => {
    const layout = layoutPagesVertical(pages, { margin: 10 });
    expect(findPageIndexAt(layout, { x: 300, y: 400 })).toBe(0);
    expect(findPageIndexAt(layout, { x: 300, y: 1000 })).toBe(1);
    expect(findPageIndexAt(layout, { x: 300, y: 855 })).toBeNull(); // in the gap
  });
});
