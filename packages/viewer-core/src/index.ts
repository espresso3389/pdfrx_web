/**
 * @packageDocumentation
 *
 * `@pdfrx/viewer-core` — the platform-independent core logic of the pdfrx_web
 * viewer.
 *
 * This package contains **no DOM access**: it is pure geometry, layout,
 * viewport math, text-flow analysis, and text-selection logic. All public
 * types are plain, JSON-serializable objects so the exact same test vectors
 * can be shared across implementations.
 *
 * Modules:
 * - `geometry` — rect/point math, rotation, and PDF page space <->
 *   document space conversions.
 * - `transform` — the {@link ViewTransform} (uniform scale +
 *   translation), fit calculations, page anchors, and boundary/overscroll
 *   clamping.
 * - `layout` — vertical/horizontal page layout.
 * - `text` / `text-formatter` — the structured page text model
 *   and its flow analysis (reading order, line splitting, word/space/newline
 *   fragments).
 * - `selection` — nearest-character hit testing, A/B anchors, word
 *   selection, and per-page range expansion.
 *
 * Coordinate spaces: **PDF page space** is points (1/72"), origin
 * bottom-left, y-up, `top >= bottom`; **document space** is y-down over the
 * whole laid-out document; **view space** is document space transformed by a
 * {@link ViewTransform}.
 */

export * from './geometry.js';
export * from './layout.js';
export * from './selection.js';
export * from './text.js';
export * from './text-formatter.js';
export * from './transform.js';
