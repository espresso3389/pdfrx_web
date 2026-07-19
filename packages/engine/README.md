# @pdfrx/engine

A typed TypeScript client for the [pdfrx](https://github.com/espresso3389/pdfrx)
pdfium WASM engine. It runs pdfium in a Web Worker and exposes a
promise-based document API: open/render pages, extract text with
per-character bounding boxes, links, outline, font registration, and PDF
re-encoding. This is the engine layer underneath
[`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer); use it
directly when you only need rendering/extraction without the viewer UI.

The pdfium WASM binaries (`assets/pdfium_worker.js`, `assets/pdfium.wasm`)
are bundled in this package and are developed in the pdfrx repository.

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

- `openUrl` (HTTP range access supported via `preferRangeAccess`), `openData`,
  `createNew`, `createFromJpegData` — all with password retry via
  `passwordProvider`
- `PdfPage.render` — partial-region rendering for tiled/zoomed views
  (`x`, `y`, `width`, `height` vs `fullWidth`, `fullHeight`)
- `PdfPage.loadText` / `loadLinks`, `PdfDocument.loadOutline`
- Progressive page loading: `openUrl(url, { useProgressiveLoading: true })` +
  `doc.loadPagesProgressively()`
- Font management: `addFontData` / `reloadFonts` / `clearAllFontData`
  (registered fonts persist in IndexedDB)
- `doc.encodePdf()` — serialize back to PDF bytes
- Document events: `pageStatusChanged`, `loadComplete`, `missingFonts`

The worker postMessage protocol is documented in `src/protocol.ts`; it is the
shared contract with the Dart client in pdfrx.

## License

MIT. pdfium itself is licensed under the BSD-style
[PDFium license](https://pdfium.googlesource.com/pdfium/+/main/LICENSE).
