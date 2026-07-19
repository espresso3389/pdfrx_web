/**
 * Page layout — port of `PdfPageLayout` and the default `_layoutPages`
 * implementation in `pdfrx/lib/src/widgets/pdf_viewer.dart`.
 */

import { rectContains, rectFromLTWH, type Offset, type PageGeometry, type Rect, type Size } from './geometry.js';

/** Result of laying out the pages of a document. Port of `PdfPageLayout`. */
export interface PageLayout {
  /** Laid-out rect of each page in document coordinates (y-down), indexed by 0-based page order. */
  pageLayouts: Rect[];
  /** Total size of the laid-out document (all pages plus surrounding/between margins). */
  documentSize: Size;
}

/** Options for {@link layoutPagesVertical} / {@link layoutPagesHorizontal}. */
export interface LayoutPagesOptions {
  /** Margin around and between pages, in document units. Default: 8 (same as `PdfViewerParams.margin`). */
  margin?: number;
}

/** Default vertical layout: pages stacked top-to-bottom, centered horizontally. */
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

/** Horizontal variant: pages side-by-side, centered vertically. */
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

/** Find the page (0-based index) whose laid-out rect contains the document position. */
export function findPageIndexAt(layout: PageLayout, point: Offset): number | null {
  for (let i = 0; i < layout.pageLayouts.length; i++) {
    if (rectContains(layout.pageLayouts[i]!, point)) return i;
  }
  return null;
}
