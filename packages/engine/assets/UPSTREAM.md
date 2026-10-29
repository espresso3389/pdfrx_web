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

## Rebuilding the WASM

The checked-in binary was built from PDFium commit
[`c97f02a3519c99d5969514970fd8186318cdb2b0`](https://pdfium.googlesource.com/pdfium/+/c97f02a3519c99d5969514970fd8186318cdb2b0) (Chromium 8078 branch),
using `espresso3389/pdfium-binaries` commit `3213db068a34413d77eecab2a25698a970ff9a4c`
(which supplies `patches/raw_api.patch`) and Emscripten 6.0.3. Its SHA-256 is
`c344961cdfe6bdbfcd32d70bb497bad1ceccf3beebfd32e987e2c878e2b0d73d`.
The previous binary was reproduced byte-for-byte from PDFium commit `47449e8970720ccaba6ce03e49539162c9f70da8` before upgrading.

On Linux x86-64 (including WSL), install Git, Python 3, Node.js, Ninja, patch,
curl and standard build utilities, and ensure substantial free disk space and
network access. Run from the repository root with a **new**, absolute build
directory outside the checkout:

```sh
bash scripts/pdfium/build.sh /path/to/new-pdfium-build
```

The script checks out the full commit IDs in `scripts/pdfium/versions.env`,
synchronizes PDFium's DEPS, applies the builder's patches (including the local Chromium 8078 adaptation), installs the pinned
Emscripten version, and builds the WASM. The directory is disposable and is not
reused; the script does not modify an existing checkout or install the output.
It checks the bundled WASM's exports and imports, the header's `FPDFRaw_*`
exports, and statically referenced worker exports. This check cannot establish ABI or behavioral compatibility.

To update, choose and review a specific PDFium commit, update the pinned
revision and, if required, the builder/toolchain commits, then build in a fresh
directory. Patch failures or missing exports require investigation; do not
skip them. Copy the resulting `builder/pdfium/out/pdfium.wasm` into this
assets directory only after reviewing the change. Confirm the raw header still
matches the builder's API, run `npm run build`, `npm test`, and
`npm run test:visual`, and verify the viewer in a browser. Record the revision,
toolchain and output SHA-256 here, and commit the binary and metadata together.
The generated WASM may differ byte-for-byte across environments; the pinned
inputs support controlled builds, not a guarantee of bit-reproducible output.
The script does not automatically track or install the latest PDFium.
