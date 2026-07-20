# @pdfrx/engine

A typed TypeScript client for rendering PDF documents. It runs a WASM rendering
engine in a worker and exposes a promise-based document API: open/render pages,
extract text with per-character bounding boxes, links, outline, font
registration, and PDF re-encoding. This is the engine layer underneath
[`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer); use it directly
when you only need rendering/extraction without the viewer UI.

The defaults target the browser (a Web Worker, URLs resolved against
`document.baseURI`), but both are injectable, so it runs on Node, Bun, and Deno
too — see [Outside the browser](#outside-the-browser-node-bun-deno).

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

The rendering engine is bundled in this package: `assets/pdfium.wasm` is a
prebuilt [PDFium](https://pdfium.googlesource.com/pdfium/) WebAssembly binary
from [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries),
and `assets/pdfium_worker.js` is the worker that drives it (see
[`assets/UPSTREAM.md`](assets/UPSTREAM.md) for provenance).

## Installation

```sh
npm install @pdfrx/engine
```

## Usage

```ts
import { PdfrxEngine } from '@pdfrx/engine';

const engine = new PdfrxEngine({
  // Directory containing pdfium_worker.js / pdfium.wasm; any origin works.
  wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.1.1/assets/',
});

const doc = await engine.openUrl('/documents/manual.pdf');
console.log(`${doc.pages.length} pages`);

// Render page 1 at 2x into a canvas
const page = doc.pages[0];
const image = await page.render({
  fullWidth: page.width * 2,
  fullHeight: page.height * 2,
});
canvasContext.putImageData(image.toImageData(), 0, 0);

// Text with per-character rects (PDF page coordinates, y-up)
const text = await page.loadText();
console.log(text.fullText);

const links = await page.loadLinks();
const outline = await doc.loadOutline();

await doc.dispose();
engine.dispose();
```

## Outside the browser (Node, Bun, Deno)

The engine is browser-first — it resolves relative URLs against `document.baseURI`
and starts a Web Worker — but both are injectable, so it also runs on a server
runtime. Pass `baseUrl` for URL resolution and `createWorker` to start the worker
however that runtime does it:

```ts
import { Worker as NodeWorker } from 'node:worker_threads';

const engine = new PdfrxEngine({
  wasmModulesUrl: 'node_modules/@pdfrx/engine/assets/',
  baseUrl: new URL('./', import.meta.url).toString(),
  createWorker: ({ workerUrl, wasmUrl }) => {
    // bootstrap.mjs sets globalThis.pdfiumWasmUrl = wasmUrl, shims self/location
    // and postMessage/onmessage over parentPort, then runs workerUrl's script.
    const impl = new NodeWorker(new URL('./bootstrap.mjs', import.meta.url), {
      workerData: { workerUrl, wasmUrl },
    });
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: (message, transfer) => impl.postMessage(message, transfer),
      terminate: () => void impl.terminate(),
    };
    impl.on('message', (data) => worker.onmessage?.({ data }));
    impl.on('error', (e) => worker.onerror?.({ message: e.message }));
    return worker;
  },
});
```

Notes for a non-browser host: `pdfium_worker.js` is a classic worker script that
reads `pdfiumWasmUrl` from the global scope, so the bootstrap must define it
before running the script (Bun and Deno workers are ES modules with no
`importScripts`, so `eval` the fetched source there). It fetches the wasm with
`fetch`, which in Node does not accept `file:` URLs — serve the assets over HTTP
or shim `fetch`. Font persistence quietly turns itself off without IndexedDB, so
`addFontData` has to be called per session. `PdfImage.toImageData()` /
`toImageBitmap()` need browser globals, but `image.pixels` (RGBA) is plain data
you can hand to any encoder.

## API highlights

Each symbol links to its entry in the
[API reference](https://espresso3389.github.io/pdfrx_web/).

- [`openUrl`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#openurl) (HTTP range access supported via [`preferRangeAccess`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#preferrangeaccess)), [`openData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata), [`createNew`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createnew), [`createFromJpegData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createfromjpegdata) — all with password retry via [`passwordProvider`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#passwordprovider)
- [`PdfPage.render`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#render) — partial-region rendering for tiled/zoomed views (`x`, `y`, `width`, `height` vs `fullWidth`, `fullHeight`)
- Cancellable rendering: renders are queued client-side (one in the worker at a time) instead of being posted all at once, so work that is no longer wanted can be dropped before it starts. Pass a [`PdfPageRenderCancellationToken`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPageRenderCancellationToken.html) from [`createCancellationToken()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#createcancellationtoken) and `cancel()` it; `render` then resolves to `null`
- [`PdfPage.loadText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadtext) / [`loadLinks`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadlinks), [`PdfDocument.loadOutline`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadoutline)
- Progressive page loading: [`openUrl(url, { useProgressiveLoading: true })`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#useprogressiveloading) + [`doc.loadPagesProgressively()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadpagesprogressively)
- Font management: [`addFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#addfontdata) / [`reloadFonts`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#reloadfonts) / [`clearAllFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#clearallfontdata) (registered fonts persist in IndexedDB). A [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts) event carries [`PdfFontQuery`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfFontQuery.html) entries; interpret their numeric `charset` / `pitchFamily` with the [`PdfFontCharset`](https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_engine.PdfFontCharset.html) ids + [`pdfFontCharsetName`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.pdfFontCharsetName.html), and the [`isFixedPitch`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isFixedPitch.html) / [`isRomanFamily`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isRomanFamily.html) / [`isScriptFamily`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isScriptFamily.html) helpers
- Non-destructive page editing: [`setPages`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) / [`setPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage) with proxy pages from [`PdfPage.rotatedCW90()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#rotatedcw90) / [`withPageNumber`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#withpagenumber) — synchronous, no worker round-trip, no PDF rebuild, so GUI reorder/rotate is instant and undo is just restoring the previous array. `encodePdf()` materializes the arrangement
- Page manipulation — reorder, rotate, remove, duplicate, and import (cross-document) — is all `setPages` / `setPage` over proxy pages; [`assemblePages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#assemblepages) writes the arrangement back into the PDF (`encodePdf()` calls it for you)
- [`doc.encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) — serialize back to PDF bytes (reflecting page edits)
- [`doc.permissions`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#permissions) — encrypted-document permissions with [`allowsCopying`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPermissions.html#allowscopying) / `allowsPrinting` / `allowsDocumentAssembly` / `allowsModifyAnnotations` helpers
- Note: [`openData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata) copies the bytes to the worker rather than transferring them, because `data` must stay usable for a wrong-password retry and for reopening after font registration
- Document events: [`pageStatusChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagestatuschanged), [`pagesRearranged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagesrearranged), [`loadComplete`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#loadcomplete), [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts)

The worker postMessage protocol is documented in `src/protocol.ts`.

## License

MIT. pdfium itself is licensed under the BSD-style
[PDFium license](https://pdfium.googlesource.com/pdfium/+/main/LICENSE).
