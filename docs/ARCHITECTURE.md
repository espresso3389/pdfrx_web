# Architecture

pdfrx_web is a TypeScript port of the [pdfrx](https://github.com/espresso3389/pdfrx)
viewer stack. The pdfium WASM engine (`pdfium_worker.js` + `pdfium.wasm`) is
developed in the pdfrx repository and vendored here as-is; everything above it
is a faithful port of the corresponding Dart/Flutter code.

## Layering

| Layer | pdfrx_web | pdfrx (Dart) counterpart |
|---|---|---|
| Engine core | `packages/engine/assets/pdfium_worker.js` + `pdfium.wasm` (vendored) | same files, developed in `packages/pdfrx/assets` |
| Engine client | `@pdfrx/engine` (`protocol.ts`, `communicator.ts`, `document.ts`) | `pdfrx/lib/src/wasm/pdfrx_wasm.dart` |
| Core logic | `@pdfrx/viewer-core` | `pdfrx_engine` (text model/formatter) + the pure logic inside `pdf_viewer.dart` |
| Viewer shell | `@pdfrx/viewer` | the Flutter widget layer of `pdf_viewer.dart` |

### The worker protocol is the shared contract

The postMessage protocol spoken by `pdfium_worker.js` is consumed by two
clients: the Dart `pdfrx_wasm.dart` and the TypeScript `@pdfrx/engine`.
`packages/engine/src/protocol.ts` documents every command's parameter and
result shapes (18 commands: document open/close, progressive loading, page
rendering with partial regions, text with per-character rects, links,
outline, font management, `assemble`/`encodePdf`). Changes to the worker in
pdfrx must be mirrored there.

Notable client behaviors ported from `pdfrx_wasm.dart`:

- The worker runs on a `blob:` URL (bootstrap blob injects the wasm URL), so
  the engine resolves relative document URLs against `document.baseURI`
  before sending them.
- Password retry loop: empty-password first attempt, then the
  `passwordProvider` until success or `null`.
- pdfium renders BGRA8888, but the vendored worker swaps channels while copying
  the bitmap out (folded into the copy, so effectively free), so `renderPage`
  returns tightly-packed **RGBA8888** and `PdfImage.toImageData()` wraps it
  zero-copy. The RGBA rewrite is reapplied by `scripts/sync-assets.mjs` on every
  sync; upstream pdfrx stays BGRA because Flutter/Skia consumes BGRA natively.
- Missing-font queries discovered while opening a document are replayed to
  listeners that subscribe later (the Dart side gets this behavior from
  rxdart's `BehaviorSubject`).

## Coordinate conventions

Identical to pdfrx:

- **PDF page space** (`PdfRect`/`PdfPoint`): points (1/72"), origin at the
  bottom-left, y-up; `top >= bottom`.
- **Document space** (`Rect`/`Offset`): y-down, unzoomed coordinates of the
  whole laid-out document (all pages plus margins).
- **View space**: document space transformed by
  `ViewTransform {zoom, xZoomed, yZoomed}` — the port of pdfrx's
  `Matrix4` usage (`PdfMatrix4Ext`), which only ever holds uniform scale +
  translation.

`PdfPage.loadText()` / `loadLinks()` already compensate for the page
bounding-box offset (`bbLeft` / `bbBottom`), matching the Dart client.

## viewer-core: pure logic with shared test vectors

`@pdfrx/viewer-core` contains no DOM access. All types are plain
JSON-serializable objects so its test vectors can be mirrored by Dart tests:

- `geometry.ts` — rect/point math, rotation, PDF↔document conversions
  (ports of `pdf_rect.dart`, `pdf_point.dart`, `pdfrx_flutter.dart`).
- `transform.ts` — viewport math, fit calculations, 14 page anchors,
  boundary clamping and underflow alignment (`_calcMatrixFor*`,
  `_calcOverscroll`, `_adjustBoundaryMargins`).
- `layout.ts` — vertical/horizontal page layout (`_layoutPages`).
- `text.ts` / `text-formatter.ts` — the structured text model and the flow
  analysis (reading order, line splitting, word/space/newline fragments,
  vertical-text virtual-newline removal) ported from `pdf_text.dart` /
  `pdf_text_formatter.dart`.
- `selection.ts` — the text selection core: nearest-character hit testing,
  A/B anchors (same-page and cross-page), word selection, per-page range
  expansion (`_findTextAndIndexForPoint`, `_updateTextSelection`,
  `selectWord`).

## viewer: canvas shell

Text selection is painted on the canvas — deliberately **no DOM text layer**;
the canvas approach is a core pdfrx design decision that enables selection
behavior DOM ranges cannot express. The shell adds:

- a pointer state machine (`pan / select / dragHandle / pinch`) replacing
  Flutter's gesture arena: mouse text-drag selects, background drag pans,
  touch pans with long-press word selection and draggable A/B handles;
- the selection magnifier lens (port of `_getMagnifierRect` and the
  positioning logic with edge flipping);
- page bitmap cache with capped base renders plus high-zoom sharp patches
  rendered for the visible region (simplified `_PdfPageImageCache` +
  partial rendering);
- edge auto-scroll during selection drags, fling inertia, links overlay,
  context menu, keyboard navigation, text search
  (`PdfTextSearcher` port), printing via a hidden iframe;
- missing-font fallback: `missingFonts` events resolve through the Google
  Fonts resolver (port of the pdfrx example's
  `CompositeGoogleFontsResolver`), then the document is reopened with the
  view state preserved — pdfium caches substituted fonts per document, so a
  mapper refresh alone is not enough (the Dart viewer does
  `load(forceReload: true)` for the same reason). The worker persists
  registered fonts in IndexedDB (`pdfrx.fonts`), so later sessions resolve
  instantly. `packages/viewer/src/font-tables.ts` is generated from the
  Dart resolver by `scripts/gen-font-tables.mjs`.

## Known limitations / not ported yet

- Form filling: requires exposing PDFium `FORM_On*` APIs from the pdfium
  worker in the pdfrx repository (protocol extension).
- Page reassembly (`assemble`) and page-set mutation APIs; `encodePdf`
  encodes the document as-is.
- Scroll physics beyond exponential-decay fling (no platform-specific
  curves), annotation editing.
