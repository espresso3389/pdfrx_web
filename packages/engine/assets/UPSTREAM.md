# Vendored WASM engine assets

`pdfium_worker.js` and `pdfium.wasm` are the bundled rendering engine, committed
to this repo so it builds standalone.

- Originally sourced from https://github.com/espresso3389/pdfrx
  (`packages/pdfrx/assets`) at commit `03e2d3af078a7fb937ef3f7a604bb4477a6187e9`.
- `pdfium_worker.js` carries one local modification: the render bitmap copy-out
  emits **RGBA** (Canvas/WebGL-ready) instead of the engine's native BGRA. These
  files are now maintained in place; re-apply the RGBA change if you replace them
  with a newer build (see `PdfImage` in `packages/engine/src/types.ts`).
