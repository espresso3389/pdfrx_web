# Vendored WASM engine assets

`pdfium.wasm` and `pdfium_worker.js` are the bundled rendering engine, committed
to this repo so it builds standalone. Both are now maintained here directly.

## `pdfium.wasm`

A prebuilt PDFium WebAssembly binary from
[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries) — a
general-purpose PDFium build, not specific to this project. Update it by
dropping in a newer build from that project. PDFium is licensed under the
BSD-style [PDFium license](https://pdfium.googlesource.com/pdfium/+/main/LICENSE).

## `pdfium_worker.js`

The Web Worker that drives `pdfium.wasm` and speaks the postMessage protocol in
`packages/engine/src/protocol.ts`. It originated in the
[pdfrx](https://github.com/espresso3389/pdfrx) project and is maintained here as
a fork.

- Local modification: the render bitmap copy-out emits **RGBA** (Canvas/WebGL-
  ready) instead of PDFium's native BGRA. If you re-sync it from upstream,
  re-apply that change (see `PdfImage` in `packages/engine/src/types.ts`).
