/**
 * @packageDocumentation
 * Canvas-based PDF viewer for the browser — the top layer of the pdfrx_web
 * TypeScript port of Dart's [pdfrx](https://github.com/espresso3389/pdfrx).
 *
 * Use it either declaratively as the `<pdfrx-viewer>` custom element
 * ({@link PdfrxViewerElement} / {@link definePdfrxViewerElement}) or
 * imperatively as the {@link PdfrxViewer} class. Both render pages, text
 * selection, links, and search highlights onto a single `<canvas>` — there is
 * deliberately no DOM text layer (see the pdfrx design notes in
 * `docs/ARCHITECTURE.md`).
 *
 * Built on {@link https://www.npmjs.com/package/@pdfrx/engine | @pdfrx/engine}
 * (the pdfium WASM worker client) and `@pdfrx/viewer-core` (the DOM-free
 * geometry/selection logic ported from `pdf_viewer.dart`).
 *
 * Companion helpers: {@link PdfTextSearcher} for interactive search and
 * {@link googleFontsResolver} for substituting fonts the PDF does not embed.
 */

export { PdfrxViewer, type PdfrxViewerOptions } from './viewer.js';
export { definePdfrxViewerElement, PdfrxViewerElement } from './element.js';
export { PdfTextSearcher, type SearchMatch, type StartTextSearchOptions } from './text-searcher.js';
export { googleFontsResolver, type FontResolution, type FontResolver } from './font-fallback.js';
