# @pdfrx/engine

A typed TypeScript client for rendering PDF documents in the browser. It runs a
WASM rendering engine in a Web Worker and exposes a promise-based document API:
open/render pages, extract text with per-character bounding boxes, links,
outline, font registration, and PDF re-encoding. This is the engine layer
underneath [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer); use
it directly when you only need rendering/extraction without the viewer UI.

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

The WASM binaries (`assets/pdfium_worker.js`, `assets/pdfium.wasm`) are bundled
in this package.

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

## API highlights

Each symbol links to its entry in the
[API reference](https://espresso3389.github.io/pdfrx_web/).

- [`openUrl`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#openurl) (HTTP range access supported via [`preferRangeAccess`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#preferrangeaccess)), [`openData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata), [`createNew`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createnew), [`createFromJpegData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createfromjpegdata) — all with password retry via [`passwordProvider`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#passwordprovider)
- [`PdfPage.render`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#render) — partial-region rendering for tiled/zoomed views (`x`, `y`, `width`, `height` vs `fullWidth`, `fullHeight`)
- [`PdfPage.loadText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadtext) / [`loadLinks`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadlinks), [`PdfDocument.loadOutline`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadoutline)
- Progressive page loading: [`openUrl(url, { useProgressiveLoading: true })`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#useprogressiveloading) + [`doc.loadPagesProgressively()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadpagesprogressively)
- Font management: [`addFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#addfontdata) / [`reloadFonts`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#reloadfonts) / [`clearAllFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#clearallfontdata) (registered fonts persist in IndexedDB)
- [`doc.encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) — serialize back to PDF bytes
- Document events: [`pageStatusChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagestatuschanged), [`loadComplete`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#loadcomplete), [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts)

The worker postMessage protocol is documented in `src/protocol.ts`.

## License

MIT. pdfium itself is licensed under the BSD-style
[PDFium license](https://pdfium.googlesource.com/pdfium/+/main/LICENSE).
