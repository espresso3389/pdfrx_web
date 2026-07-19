# pdfrx_web

TypeScript port of the [pdfrx](https://github.com/espresso3389/pdfrx) viewer stack for the browser,
built on pdfrx's pdfium WASM engine.

## Architecture

The pdfium WASM engine (`pdfium_worker.js` + `pdfium.wasm`) is developed in the pdfrx
repository and consumed here as-is — the postMessage protocol between the worker and its
clients is the shared contract between the Dart client (`pdfrx/lib/src/wasm/pdfrx_wasm.dart`)
and the TypeScript client in this repo.

| Package | Description |
|---|---|
| `@pdfrx/engine` | Typed client for the pdfium worker protocol: open/render pages, text with char rects, links, outline, progressive loading, font management. Counterpart of `pdfrx_wasm.dart`. |
| `@pdfrx/viewer-core` | Platform-independent core logic ported from pdfrx: geometry/rotation math (`pdf_rect.dart`, `pdfrx_flutter.dart` conversions), page layout, viewport transform + boundary clamping (`PdfMatrix4Ext`, `_calcMatrixFor*`, `_calcOverscroll`), structured text flow analysis (`pdf_text_formatter.dart`), and the text selection core (`_findTextAndIndexForPoint`, `_updateTextSelection`, `selectWord`). Pure TS, no DOM; covered by vitest suites whose vectors are designed to be mirrored on the Dart side. |
| `@pdfrx/viewer` | Canvas2D + Pointer Events viewer shell exposing the `<pdfrx-viewer>` custom element. Pan/zoom (drag, wheel, ctrl+wheel, pinch) with boundary clamping and touch fling inertia, page bitmap cache + high-zoom sharp patches, canvas-painted text selection (mouse text-drag, double-click word, touch long-press + draggable handles + magnifier lens — no DOM text layer, by design), edge auto-scroll during selection drags, context menu (Copy / Select All, auto-shown after touch selection), links overlay (hover highlight, external URLs via noopener, internal dest jumps), clipboard copy (Ctrl+C / Ctrl+A / Esc). |
| `@pdfrx/example-basic` | Vite app hosting `<pdfrx-viewer>` with a search bar, thumbnails/outline sidebar, and print button. |

The viewer also provides: keyboard navigation (PageUp/Down, Space, Home/End,
arrows, Ctrl+= / Ctrl+-), text search (`createTextSearcher()`, a port of
pdfrx's `PdfTextSearcher` with progressive per-page search and match
highlighting), explicit-destination navigation (`goToDest`, xyz/fit/fitH/
fitV/fitR), page thumbnails (`renderPageThumbnail`), outline loading, and
printing (`print()`, renders pages at ~150 DPI into a hidden iframe).

Planned next: form filling (requires exposing PDFium `FORM_On*` APIs from the
pdfium worker in the pdfrx repository), annotation editing, vertical-text
selection handle refinements.

## Development

```sh
npm install
npm run build     # builds all packages
npm run dev       # runs the basic example (Vite)
```

The pdfium engine assets (`packages/engine/assets/pdfium_worker.js` /
`pdfium.wasm`) are vendored in this repository, so a plain clone builds and
runs standalone — no submodule, no postinstall.

### Updating from pdfrx (maintainers)

The pdfrx repository stays the single source of truth for the engine assets
and the Google Fonts tables. It is available as the `external/pdfrx`
submodule:

```sh
git submodule update --init      # once
node scripts/sync-assets.mjs     # refresh pdfium_worker.js / pdfium.wasm (+ UPSTREAM.md)
node scripts/gen-font-tables.mjs # regenerate packages/viewer/src/font-tables.ts
```

Both scripts also accept an explicit checkout path or the `PDFRX_REPO`
environment variable instead of the submodule.

## Coordinate convention

Same as pdfrx: PDF page coordinates in points (1/72"), origin bottom-left, y-up.
Rects are `{left, top, right, bottom}` with `top >= bottom`. `PdfPage.loadText()` /
`loadLinks()` already compensate for the page bounding-box offset (`bbLeft` / `bbBottom`),
matching the Dart implementation.

## Notes

- The worker is spawned via a bootstrap blob, so `wasmModulesUrl` may point at any origin;
  URLs passed to `openUrl` are resolved against `document.baseURI` before being sent to
  the worker.
- `PdfImage` holds BGRA pixels as produced by pdfium; use `toImageData()` /
  `toImageBitmap()` for Canvas 2D.
- Page reassembly (`assemble`) and form-filling APIs are not ported yet.
