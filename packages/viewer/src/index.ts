/**
 * @packageDocumentation
 * Canvas-based PDF viewer for the browser.
 *
 * Use it either declaratively as the `<pdfrx-viewer>` custom element
 * ({@link PdfrxViewerElement} / {@link definePdfrxViewerElement}) or
 * imperatively as the {@link PdfrxViewer} class. Both render pages, text
 * selection, links, and search highlights onto a single `<canvas>` — there is
 * deliberately no DOM text layer (see the design notes in
 * `docs/ARCHITECTURE.md`).
 *
 * Built on {@link https://www.npmjs.com/package/@pdfrx/engine | @pdfrx/engine}
 * (the rendering-engine worker client) and `@pdfrx/viewer-core` (the DOM-free
 * geometry/selection logic).
 *
 * Companion helpers: {@link PdfTextSearcher} for interactive search and
 * {@link googleFontsResolver} for substituting fonts the PDF does not embed.
 */

export {
  PdfrxViewer,
  type PdfrxViewerOptions,
  type AnnotationTool,
  type AnnotationStyle,
  type FitMode,
  type PageDropShadow,
  type PageBorder,
  type PagePaintCallback,
  type PageOverlaysBuilder,
  type PageOverlayInfo,
  type PdfLoadingProgress,
  type PdfTextSelection,
  type PdfTextSelectionPoint,
  type PdfTextSelectionRange,
  type PdfSelectedTextRange,
  type SelectionChangeListener,
  type PdfPageHitTestResult,
  type PageChangeListener,
  type LinkTapHandler,
  type ContextMenuBuilder,
  type ContextMenuContext,
  type LayoutDirection,
  type LayoutPagesFn,
  type PdfViewerTapEvent,
  type PdfViewerTapType,
  type PanAxis,
  type ViewerOverlayBuilder,
} from './viewer.js';
export type {
  PdfRect,
  PdfPoint,
  Offset,
  PageGeometry,
  PageLayout,
  LayoutPagesOptions,
  ViewTransform,
} from '@pdfrx/viewer-core';
export { layoutPagesVertical, layoutPagesHorizontal } from '@pdfrx/viewer-core';
export { definePdfrxViewerElement, PdfrxViewerElement } from './element.js';
export { PdfTextSearcher, type SearchMatch, type StartTextSearchOptions } from './text-searcher.js';
export { googleFontsResolver, type FontResolution, type FontResolver } from './font-fallback.js';
