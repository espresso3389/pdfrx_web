# @pdfrx/engine

A typed TypeScript client for rendering PDF documents. It runs a WASM rendering
engine in a worker and exposes a promise-based document API: open/render pages,
extract text with per-character bounding boxes, links, outline, AcroForm
fields, annotations, font registration, page arrangement, and PDF re-encoding. This is the engine layer underneath
[`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer); use it directly
when you only need rendering/extraction without the viewer UI.

It is built for the browser but not confined to it: the same package runs on
Node, Bun, and Deno with no extra configuration — see
[Outside the browser](#outside-the-browser-node-bun-deno).

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
  wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.9.0/assets/',
});

const doc = await engine.openUrl('/documents/manual.pdf');
console.log(`${doc.pages.length} pages`);

// Render page 1 at 2x into a canvas
const page = doc.pages[0];
if (!page) throw new Error('The document has no pages');
const image = await page.render({
  fullWidth: page.width * 2,
  fullHeight: page.height * 2,
});
if (image) canvasContext.putImageData(image.toImageData(), 0, 0);

// Text with per-character rects (PDF page coordinates, y-up)
const text = await page.loadText();
console.log(text?.fullText ?? '');

const links = await page.loadLinks();
const outline = await doc.loadOutline();

await doc.dispose();
engine.dispose();
```

## Outside the browser (Node, Bun, Deno)

Nothing to configure: the WASM assets are read from this package's own `assets/`
directory, the worker is started the way the host runs workers (a module worker
on Bun and Deno, a `node:worker_threads` worker on Node), and relative URLs
resolve against the current working directory instead of `document.baseURI`.

```ts
import { readFile } from 'node:fs/promises';
import { PdfrxEngine } from '@pdfrx/engine';

const engine = new PdfrxEngine();
const doc = await engine.openData(await readFile('manual.pdf'));

const page = doc.pages[0];
if (!page) throw new Error('The document has no pages');
const image = await page.render({ fullWidth: page.width * 2, fullHeight: page.height * 2 });
// image.pixels is plain RGBA — hand it to sharp, jimp, or whatever encodes for you
if (image) console.log(image.width, image.height);
console.log((await page.loadText())?.fullText ?? '');

await doc.dispose();
engine.dispose(); // terminates the worker, which otherwise keeps the process alive
```

Two behavioral differences are worth knowing. Font registrations do not persist,
because that uses IndexedDB, so `addFontData` has to be called per session. And
`PdfImage.toImageData()` / `toImageBitmap()` need browser globals — use
`image.pixels` instead.

Two escape hatches, if the automatic setup does not fit. `wasmModulesUrl` still
overrides where the assets are read from — needed when the package's files are
not on disk as published, e.g. a bundled server build. And `createWorker` takes
over starting the worker: for a host the engine does not recognize, or a worker
that needs options of its own. It receives `{ workerUrl, wasmUrl }` and returns
anything Web-Worker-shaped (`postMessage`, `terminate`, `onmessage`, `onerror`),
possibly as a promise.

## API highlights

Each symbol links to its entry in the
[API reference](https://espresso3389.github.io/pdfrx_web/).

- [`openUrl`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#openurl) (HTTP range access supported via [`preferRangeAccess`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#preferrangeaccess)), [`openData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata), [`createNew`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createnew), [`createFromImages`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createfromimages) (one page per image — JPEG decoded natively, other formats via the runtime's decoder) — all with password retry via [`passwordProvider`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#passwordprovider)
- [`PdfPage.render`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#render) — partial-region rendering for tiled/zoomed views (`x`, `y`, `width`, `height` vs `fullWidth`, `fullHeight`)
- Cancellable rendering: renders are queued client-side (one in the worker at a time) instead of being posted all at once, so work that is no longer wanted can be dropped before it starts. Pass a [`PdfPageRenderCancellationToken`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPageRenderCancellationToken.html) from [`createCancellationToken()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#createcancellationtoken) and `cancel()` it; `render` then resolves to `null`
- [`PdfPage.loadText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadtext) / [`loadLinks`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadlinks), [`PdfDocument.loadOutline`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadoutline)
- Document-wide annotation queries: `doc.loadAnnotations({ subtype: 'highlight' })`, or `doc.loadHighlights({ includeText: true })` to include the highlighted page text
- External annotation persistence and collaboration: `exportAnnotations()` / `restoreAnnotations()` preserve stable ids, `serializeAnnotationSnapshot()` handles binary FreeText appearance data, and `applyAnnotationChanges()` applies `add` / `update` / `remove` batches. `annotationsChanged` includes the exact changes plus `origin`, `transactionId`, and `actorId`; publish local/user changes and apply incoming changes with `origin: 'remote'` to prevent echo loops. Each annotation carries its last `actorId` and monotonic `revision`.
- Progressive page loading: [`openUrl(url, { useProgressiveLoading: true })`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#useprogressiveloading) + [`doc.loadPagesProgressively()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadpagesprogressively)
- Font management: [`addFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#addfontdata) / [`reloadFonts`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#reloadfonts) / [`clearAllFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#clearallfontdata) (registered fonts persist in IndexedDB). A [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts) event carries [`PdfFontQuery`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfFontQuery.html) entries; interpret their numeric `charset` / `pitchFamily` with the [`PdfFontCharset`](https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_engine.PdfFontCharset.html) ids + [`pdfFontCharsetName`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.pdfFontCharsetName.html), and the [`isFixedPitch`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isFixedPitch.html) / [`isRomanFamily`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isRomanFamily.html) / [`isScriptFamily`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isScriptFamily.html) helpers
- Non-destructive page editing: [`setPages`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) / [`setPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage) with proxy pages from [`PdfPage.rotatedCW90()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#rotatedcw90) / [`withPageNumber`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#withpagenumber) — synchronous, no worker round-trip, no PDF rebuild, so GUI reorder/rotate is instant and undo is just restoring the previous array. `encodePdf()` materializes the arrangement
- Page manipulation — reorder, rotate, remove, duplicate, and import (cross-document) — is all `setPages` / `setPage` over proxy pages; [`assemblePages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#assemblepages) writes the arrangement back into the PDF (`encodePdf()` calls it for you)
- [`doc.encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) — materialize the arrangement into the live document and serialize it
- [`doc.encodePdfCopy()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdfcopy) — assemble and serialize through a temporary copy, preserving the live document's proxy arrangement
- `encodePdfCopy()` chooses the sole imported source as its copy base when every arranged page comes from that source, preserving that source's document-level AcroForm, outline, metadata, and name trees. For a mixed-source arrangement it preserves the root document's catalog; merging document-level structures from every source is an application-level export-composition concern because PDFium page import copies pages, not catalogs.
- AcroForm: `loadFormFields()` / `getFormFieldValue()` / `setFormFieldValue()`, `formFieldsChanged`, and JS-free `AFSimple_Calculate` support for SUM/PRD/AVG/MIN/MAX. Arbitrary field JavaScript is not executed.
- Text orientation is explicit: FreeText specs expose `textOrientation`, and form fields expose `textOrientations` parallel to Widget rects. Intrinsic 0/90/180/270-degree rotation can follow the page or remain viewport-upright.
- [`doc.permissions`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#permissions) — encrypted-document permissions with [`allowsCopying`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPermissions.html#allowscopying) / `allowsPrinting` / `allowsDocumentAssembly` / `allowsModifyAnnotations` helpers
- Note: [`openData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata) copies the bytes to the worker rather than transferring them, because `data` must stay usable for a wrong-password retry and for reopening after font registration
- Document events: [`pageStatusChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagestatuschanged), [`pagesRearranged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagesrearranged), [`loadComplete`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#loadcomplete), [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts)

The worker postMessage protocol is documented in `src/protocol.ts`.

## The pdfrx_web family

| Package | Role |
|---|---|
| [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) | React components and hooks over `@pdfrx/viewer`. |
| [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) | Framework-agnostic `<canvas>` viewer + `<pdfrx-viewer>` element. |
| [`@pdfrx/viewer-core`](https://www.npmjs.com/package/@pdfrx/viewer-core) | DOM-free geometry / layout / selection logic. |
| **`@pdfrx/engine`** (this package) | Typed client for the WASM rendering worker. |

Full [API reference](https://espresso3389.github.io/pdfrx_web/) ·
[repository](https://github.com/espresso3389/pdfrx_web) ·
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)

## License

MIT. pdfium itself is licensed under the BSD-style
[PDFium license](https://pdfium.googlesource.com/pdfium/+/main/LICENSE).
