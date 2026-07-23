# Vendored WASM engine assets

`pdfium.wasm` and `pdfium_worker.js` are the bundled rendering engine, committed
to this repo so it builds standalone. Both are now maintained here directly.

## `pdfium.wasm`

A custom PDFium WebAssembly build produced from the
[espresso3389/pdfium-binaries](https://github.com/espresso3389/pdfium-binaries/)
backend/toolchain (itself derived from `bblanchon/pdfium-binaries`). It adds the
public C interface in [`fpdf_raw.h`](fpdf_raw.h) that backs
`@pdfrx/engine`'s document-level PDF object inspection and editing. A
replacement build must export every `FPDFRaw_*` symbol declared there in
addition to PDFium's normal public API. PDFium is licensed under the BSD-style
[PDFium license](https://pdfium.googlesource.com/pdfium/+/main/LICENSE).

## `pdfium_worker.js`

The Web Worker that drives `pdfium.wasm` and speaks the postMessage protocol in
`packages/engine/src/protocol.ts`. It originated in the
[pdfrx](https://github.com/espresso3389/pdfrx) project and is maintained here as
a fork.

- Local modification: the render bitmap copy-out emits **RGBA** (Canvas/WebGL-
  ready) instead of PDFium's native BGRA. If you re-sync it from upstream,
  re-apply that change (see `PdfImage` in `packages/engine/src/types.ts`).
- Local modification: the raw-object command layer wraps `FPDFRaw_*` with typed
  structured-clone values and batched dictionary, array, and stream patches.
