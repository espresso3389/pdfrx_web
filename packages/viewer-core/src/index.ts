/**
 * @packageDocumentation
 *
 * `@pdfrx/viewer-core` — the platform-independent core logic of the pdfrx_web
 * viewer, ported faithfully from the pure (non-Flutter) parts of
 * [pdfrx](https://github.com/espresso3389/pdfrx).
 *
 * This package contains **no DOM access**: it is pure geometry, layout,
 * viewport math, text-flow analysis, and text-selection logic. All public
 * types are plain, JSON-serializable objects so the exact same test vectors
 * can be mirrored by the Dart implementation.
 *
 * Modules:
 * - `geometry` — rect/point math, rotation, and PDF page space <->
 *   document space conversions (ports of `pdf_rect.dart`, `pdf_point.dart`,
 *   `pdfrx_flutter.dart`).
 * - `transform` — the {@link ViewTransform} (uniform scale +
 *   translation), fit calculations, page anchors, and boundary/overscroll
 *   clamping (ports of `_calcMatrixFor*`, `_calcOverscroll`,
 *   `_adjustBoundaryMargins`).
 * - `layout` — vertical/horizontal page layout (`_layoutPages`).
 * - `text` / `text-formatter` — the structured page text model
 *   and its flow analysis (reading order, line splitting, word/space/newline
 *   fragments) ported from `pdf_text.dart` / `pdf_text_formatter.dart`.
 * - `selection` — nearest-character hit testing, A/B anchors, word
 *   selection, and per-page range expansion.
 *
 * Coordinate spaces (identical to pdfrx): **PDF page space** is points
 * (1/72"), origin bottom-left, y-up, `top >= bottom`; **document space** is
 * y-down over the whole laid-out document; **view space** is document space
 * transformed by a {@link ViewTransform}.
 */

export * from './geometry.js';
export * from './layout.js';
export * from './selection.js';
export * from './text.js';
export * from './text-formatter.js';
export * from './transform.js';
