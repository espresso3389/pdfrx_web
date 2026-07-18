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
| `@pdfrx/example-basic` | Vite app hosting `<pdfrx-viewer>`. |

Planned next: keyboard navigation (page up/down, arrows), search UI,
thumbnails/outline panes, form filling, printing.

## Development

```sh
# Copy pdfium_worker.js / pdfium.wasm (and the sample PDF) from a pdfrx checkout
node scripts/sync-assets.mjs path/to/pdfrx

npm install
npm run build     # builds @pdfrx/engine
npm run dev       # runs the basic example (Vite)
```

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
