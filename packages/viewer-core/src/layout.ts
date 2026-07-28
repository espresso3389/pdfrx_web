/**
 * Page layout — the page-rect computation for a document.
 *
 */

import { rectContains, rectFromLTWH, type Offset, type PageGeometry, type Rect, type Size } from './geometry.js';

/** Result of laying out the pages of a document. */
export interface PageLayout {
  /** Laid-out rect of each page in document coordinates (y-down), indexed by 0-based page order. */
  pageLayouts: Rect[];
  /** Total size of the laid-out document (all pages plus surrounding/between margins). */
  documentSize: Size;
}

/** Options for {@link layoutPagesVertical} / {@link layoutPagesHorizontal}. */
export interface LayoutPagesOptions {
  /** Margin around and between pages, in document units. Default: 8. */
  margin?: number;
}

/** Pairing used by {@link layoutPagesSpread}. */
export type SpreadMode = 'odd' | 'even';

/**
 * Vertical book/spread layout.
 *
 * `odd` pairs pages `[1, 2], [3, 4]`; `even` leaves the cover alone and then
 * pairs `[2, 3], [4, 5]`. Rows are centered and their pages are aligned at the
 * top, which keeps differently sized pages predictable.
 * @param pages - The pages to process, in document order.
 * @param mode - The mode value (SpreadMode).
 * @param options - Options that customize the operation.
 * @returns The resulting PageLayout.
 *
 */
export function layoutPagesSpread(
  pages: readonly PageGeometry[],
  mode: SpreadMode,
  options: LayoutPagesOptions = {},
): PageLayout {
  const margin = options.margin ?? 8;
  const rows: Array<readonly [number] | readonly [number, number]> = [];
  let index = 0;
  if (mode === 'even' && pages.length > 0) {
    rows.push([0]);
    index = 1;
  }
  while (index < pages.length) {
    rows.push(index + 1 < pages.length ? [index, index + 1] : [index]);
    index += 2;
  }

  const rowWidths = rows.map((row) =>
    row.reduce((width, pageIndex) => width + pages[pageIndex]!.width, 0)
      + (row.length - 1) * margin,
  );
  const contentWidth = rowWidths.reduce((width, rowWidth) => Math.max(width, rowWidth), 0);
  const pageLayouts: Rect[] = new Array(pages.length);
  let y = margin;
  rows.forEach((row, rowIndex) => {
    let x = margin + (contentWidth - rowWidths[rowIndex]!) / 2;
    let rowHeight = 0;
    for (const pageIndex of row) {
      const page = pages[pageIndex]!;
      pageLayouts[pageIndex] = rectFromLTWH(x, y, page.width, page.height);
      x += page.width + margin;
      rowHeight = Math.max(rowHeight, page.height);
    }
    y += rowHeight + margin;
  });

  return {
    pageLayouts,
    documentSize: { width: contentWidth + margin * 2, height: y },
  };
}

/**
 * Default vertical layout: pages stacked top-to-bottom, centered horizontally.
 *
 * @param pages - The pages to process, in document order.
 * @param options - Options that customize the operation.
 * @returns The resulting PageLayout.
 *
 */
export function layoutPagesVertical(pages: readonly PageGeometry[], options: LayoutPagesOptions = {}): PageLayout {
  const margin = options.margin ?? 8;
  const width = pages.reduce((w, p) => Math.max(w, p.width), 0) + margin * 2;

  const pageLayouts: Rect[] = [];
  let y = margin;
  for (const page of pages) {
    pageLayouts.push(rectFromLTWH((width - page.width) / 2, y, page.width, page.height));
    y += page.height + margin;
  }

  return { pageLayouts, documentSize: { width, height: y } };
}

/**
 * Horizontal variant: pages side-by-side, centered vertically.
 *
 * @param pages - The pages to process, in document order.
 * @param options - Options that customize the operation.
 * @returns The resulting PageLayout.
 *
 */
export function layoutPagesHorizontal(pages: readonly PageGeometry[], options: LayoutPagesOptions = {}): PageLayout {
  const margin = options.margin ?? 8;
  const height = pages.reduce((h, p) => Math.max(h, p.height), 0) + margin * 2;

  const pageLayouts: Rect[] = [];
  let x = margin;
  for (const page of pages) {
    pageLayouts.push(rectFromLTWH(x, (height - page.height) / 2, page.width, page.height));
    x += page.width + margin;
  }

  return { pageLayouts, documentSize: { width: x, height } };
}

/**
 * Find the page (0-based index) whose laid-out rect contains the document position.
 *
 * @param layout - The layout value (PageLayout).
 * @param point - The point to process.
 * @returns The resolved number or `null`.
 *
 */
export function findPageIndexAt(layout: PageLayout, point: Offset): number | null {
  for (let i = 0; i < layout.pageLayouts.length; i++) {
    if (rectContains(layout.pageLayouts[i]!, point)) return i;
  }
  return null;
}
