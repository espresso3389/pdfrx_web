# @pdfrx/engine guide

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
custom [PDFium](https://pdfium.googlesource.com/pdfium/) WebAssembly build based
on the [espresso3389/pdfium-binaries](https://github.com/espresso3389/pdfium-binaries/)
backend/toolchain. That build adds the small raw PDF-object C API used by
[`PdfDocument`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html)'s
custom object inspection and editing features;
`assets/pdfium_worker.js` is the worker that drives it (see
[`assets/UPSTREAM.md`](https://github.com/espresso3389/pdfrx_web/blob/master/packages/engine/assets/UPSTREAM.md)
for provenance).

## Installation

```sh
npm install @pdfrx/engine
```

## Usage

```ts
import { PdfrxEngine } from '@pdfrx/engine';

const engine = new PdfrxEngine({
  // Directory containing pdfium_worker.js / pdfium.wasm; any origin works.
wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.22.2/assets/',
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

Two behavioral differences are worth knowing. Font registrations do not persist
by default because IndexedDB is unavailable; use the opt-in disk cache below to
retain them across sessions. And
[`PdfImage.toImageData()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfImage.html#toimagedata) /
[`toImageBitmap()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfImage.html#toimagebitmap)
need browser globals — use
`image.pixels` instead.

### Local fonts and a server-side font cache

Local filesystem access is opt-in. Pass `localFonts` to discover conventional
font directories for the current Windows, macOS, or Linux host and optionally
add application directories:

```ts
const engine = new PdfrxEngine({
  localFonts: {
    systemDirectories: true,
    directories: ['/opt/my-service/fonts'],
  },
  fontCache: {
    directory: '/var/cache/my-service/pdfrx-fonts',
    persistRegisteredFonts: true,
  },
});
```

The engine recursively indexes TTF, OTF, and TTC files by their internal family,
full, and PostScript names. When opening a document reports a missing face, only
the best matching weight/style is loaded and the document is reopened once so
PDFium uses the new mapping.

With `fontCache.directory`, the metadata index is cached and validated against
file size and modification time on the next process start. Set
`persistRegisteredFonts` to copy bytes supplied to `addFontData()` into that
cache; it defaults to false because font licenses and application security
policies differ. OS fonts themselves are not copied.

On Deno, grant read permission for the selected font directories and read/write
permission for the cache directory. Unreadable font directories and individual
malformed font files are skipped; a configured cache that cannot be written
rejects initialization instead of silently disabling persistence.

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
- Cancellable rendering: renders are queued client-side (one in the worker at a time) instead of being posted all at once, so work that is no longer wanted can be dropped before it starts. Pass a [`PdfPageRenderCancellationToken`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPageRenderCancellationToken.html) from [`createCancellationToken()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#createcancellationtoken) and [`cancel()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPageRenderCancellationToken.html#cancel) it; `render` then resolves to `null`
- [`PdfPage.loadText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadtext) /
  [`loadLinks`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadlinks).
  Auto-detected URL text is explicitly marked as non-persisted. Persisted Link
  annotations are returned by `loadAnnotations()` and use the same annotation
  CRUD API as every other subtype. Link targets use
  [`PdfLinkTarget`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_engine.PdfLinkTarget.html).
- [`PdfDocument.loadOutline`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadoutline) /
  [`setOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setoutline)
  read and synchronously replace the logical bookmark tree as ordinary
  immutable JavaScript objects. The physical PDF is updated later by
  `materialize()` or `encodePdf()`.
- Page-scoped annotation API:
  [`page.loadAnnotations()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadannotations) /
  [`loadHighlights({ includeText: true })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadhighlights)
  and
  [`page.addAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#addannotation) /
  [`updateAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#updateannotation) /
  [`removeAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#removeannotation).
  `page.document` is the current arrangement receiving change events;
  `page.sourceDocument` owns the physical page, so imported and duplicate
  placements share annotation state.
- Document-wide annotation queries:
  [`doc.loadAnnotations({ subtype: 'highlight' })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadannotations)
  and
  [`doc.loadHighlights({ includeText: true })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadhighlights)
  aggregate the current arrangement, including imported pages. Use the
  corresponding
  [`PdfPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html)
  methods when only one page is needed.
- External annotation persistence and synchronization:
  [`exportAnnotations()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#exportannotations) /
  [`restoreAnnotations()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#restoreannotations)
  preserve stable ids,
  [`serializeAnnotationSnapshot()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.serializeAnnotationSnapshot.html)
  handles binary FreeText appearance data, and
  [`applyAnnotationChanges()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#applyannotationchanges)
  applies `add` / `update` / `remove` batches. `annotationsChanged` includes the
  exact changes plus `origin`, `transactionId`, and `actorId`. These fields let
  applications distinguish mutation sources, correlate batches, avoid applying
  the same change twice, and implement revision-aware synchronization. Each
  annotation carries its last `actorId` and monotonic `revision`.
- Rectangle and FreeText annotation specs preserve independent `textColor`,
  `fontSize`,
  [`textAlign`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfAnnotationSpec.html#textalign)
  (`left` / `center` / `right`), and
  [`textVerticalAlign`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfAnnotationSpec.html#textverticalalign)
  (`top` / `middle` / `bottom`) appearance properties. Loaded
  [`PdfAnnotationObject`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfAnnotationObject.html)
  values expose the persisted alignment through the corresponding
  [`textAlign`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfAnnotationObject.html#textalign)
  and
  [`textVerticalAlign`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfAnnotationObject.html#textverticalalign)
  properties. A viewer may switch between square and FreeText according to
  whether edited text is empty while retaining their shared geometry and
  styling.
- Progressive page loading: [`openUrl(url, { useProgressiveLoading: true })`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenUrlOptions.html#useprogressiveloading) + [`doc.loadPagesProgressively()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadpagesprogressively)
- Font management: [`addFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#addfontdata) / [`reloadFonts`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#reloadfonts) / [`clearAllFontData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#clearallfontdata) (registered fonts persist in IndexedDB). A [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts) event carries [`PdfFontQuery`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfFontQuery.html) entries; interpret their numeric `charset` / `pitchFamily` with the [`PdfFontCharset`](https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_engine.PdfFontCharset.html) ids + [`pdfFontCharsetName`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.pdfFontCharsetName.html), and the [`isFixedPitch`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isFixedPitch.html) / [`isRomanFamily`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isRomanFamily.html) / [`isScriptFamily`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_engine.isScriptFamily.html) helpers
- Non-destructive page editing: [`setPages`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) / [`setPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage) with proxy pages from [`PdfPage.rotatedCW90()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#rotatedcw90) — synchronous, no worker round-trip, no PDF rebuild, so GUI reorder/rotate is instant and undo is just restoring the previous array. Page numbers are assigned automatically from the [`setPages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) array order; [`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) materializes the arrangement.
- Every [`PdfPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html)
  has a logical identity retained by placement/rotation proxies and page
  materialization. Build a following or fixed-position
  [`PdfDest`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_engine.PdfDest.html)
  with [`page.dest()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#dest).
  Repeating the same page in an arrangement repeats its identity and resolves
  to one matching placement; use
  [`page.duplicate()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#duplicate)
  for a zero-copy proxy with a distinct identity.
- Page manipulation — reorder, rotate, remove, duplicate, and import
  (cross-document) — is all
  [`setPages`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) /
  [`setPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage)
  over proxy pages; [`materialize()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#materialize) writes all pending page, outline, and Link-annotation edits into the PDF ([`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) calls it for you)
- [`doc.encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) — materialize the arrangement into the live document and serialize it
- [`doc.encodePdf({ mode })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf) selects `in-place` (default), `copy`, or `compact`. `copy` materializes through a temporary catalog-preserving clone; `compact` rebuilds the arranged pages in a fresh PDF and omits objects that are not reachable from those pages, regardless of whether they were already present in the source PDF or resulted from later edits
- [`doc.createMaterializedCopy({ catalog })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#creatematerializedcopy) returns an independent, fully materialized document while leaving the original and its pending state unchanged. `preserve` (default) retains the selected base catalog; `rebuild` creates a fresh catalog from the arranged pages, retaining their resources, annotations, and widgets but not automatically inheriting existing physical document-level outlines, metadata, name trees, signatures, or AcroForm configuration. Pending logical page, outline, and Link edits are still written to the returned document
- `encodePdf({ mode: 'copy' })` chooses the sole imported source as its copy base when every arranged page comes from that source, preserving that source's document-level AcroForm, outline, metadata, and name trees. For a mixed-source arrangement it preserves the root document's catalog; merging document-level structures from every source is an application-level export-composition concern because PDFium page import copies pages, not catalogs.
- Raster Stamp moves/resizes can pass [`preserveAppearance: true`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfAnnotationMutationOptions.html#preserveappearance) to `updateAnnotation()` so PDFium updates the annotation rectangle without registering the same image stream again
- Raw PDF-object inspection and editing:
  [`getCatalogObject()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#getcatalogobject)
  reads the catalog,
  [`getRawObject(objectNumber)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#getrawobject)
  returns a
  [`PdfRawObject`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_engine.PdfRawObject.html)
  without recursively expanding references, and
  [`editRawObjects(editor => { ... })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#editrawobjects)
  provides a
  [`PdfRawObjectEditor`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfRawObjectEditor.html)
  over typed
  [`PdfRawTarget`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfRawTarget.html)
  locations and
  [`PdfRawPatchValue`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_engine.PdfRawPatchValue.html)
  values. Its methods provide
  dictionary, array, and decoded-stream helpers over the custom `FPDFRaw_*`
  PDFium backend. Newly-created indirect dictionaries can be referenced within
  the same batch without manually assigning object numbers.
- Raw-object APIs inspect the physical PDF held by the worker. In contrast,
  [`setPages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages)
  / [`setPage()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage),
  and [`setOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setoutline)
  initially change only logical in-memory state. While
  [`hasPendingChanges`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#haspendingchanges)
  is true, call
  [`materialize()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#materialize)
  before interpreting or targeting affected page-tree, outline, annotation, or
  other raw objects and object numbers returned by `getCatalogObject()` /
  `getRawObject()`.
  [`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
  is also sufficient because it materializes first.
- [`editRawObjects()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#editrawobjects)
  first builds the complete batch without touching the
  document, so an exception in the callback applies nothing. Raw editing never
  materializes pending page, outline, or Link edits automatically; explicitly
  call `materialize()` before inspecting or targeting affected raw objects.
  The default commit
  avoids copying the PDF and is fast, but a PDFium error during application may
  leave earlier operations applied. Pass `{ atomic: true }` for complete
  all-or-nothing behavior; this applies the batch to an independent PDF copy
  and adopts it only after success, at a time and peak-memory cost proportional
  to the PDF size.
- Raw edits deliberately do not guess their GUI impact. When the document is
  displayed by `@pdfrx/viewer`, application code explicitly calls
  [`viewer.refreshPages(...)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshpages)
  for known page/cache scopes,
  [`viewer.refreshDocument()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshdocument)
  when document-derived UI state may have changed, or
  [`viewer.reloadDocument()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#reloaddocument)
  when PDFium itself must be copied and reparsed.
  These refreshes also invalidate React outline, form, annotation, search, and
  thumbnail state.
- AcroForm: [`loadFormFields()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadformfields) / [`getFormFieldValue()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#getformfieldvalue) / [`setFormFieldValue()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalue) / [`setFormFieldValues()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalues), reversible [`formFieldsChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#formfieldschanged) batches, and JS-free `AFSimple_Calculate` support for SUM/PRD/AVG/MIN/MAX. Arbitrary field JavaScript is not executed.
- Text orientation is explicit: FreeText specs expose `textOrientation`, and form fields expose `textOrientations` parallel to Widget rects. Intrinsic 0/90/180/270-degree rotation can follow the page or remain viewport-upright.
- FreeText appearance preparation is available directly through
  [`PdfDocument.prepareFreeTextAppearance()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#preparefreetextappearance-1).
  It shares grapheme, language,
  mixed-script font-run, wrapping, and emoji behavior with the viewer, works in
  browser and server runtimes, and accepts replaceable measurement, font,
  emoji-source, renderer, and cache services. See
  [Text, language, and emoji appearance](TEXT-APPEARANCE.md). Direct engine
  integrations should supply `resolveFont` when PDFium does not already have
  fonts for the scripts they author.
- [`doc.permissions`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#permissions) — encrypted-document permissions with [`allowsCopying`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPermissions.html#allowscopying) / `allowsPrinting` / `allowsDocumentAssembly` / `allowsModifyAnnotations` helpers
- [`openData`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata) transfers ownership of a full `ArrayBuffer` (or full `Uint8Array` view) to the worker by default. The caller's buffer is detached. Password retries reuse the worker-owned bytes; partial views are copied into a tightly sized transferable buffer. Set `transferData: false` in [`PdfOpenDataOptions`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfOpenDataOptions.html) to keep the input usable by transferring an internal copy instead.
- Document events: [`pageStatusChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagestatuschanged), [`pagesRearranged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#pagesrearranged), [`loadComplete`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#loadcomplete), [`missingFonts`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfDocumentEventMap.html#missingfonts)

The worker postMessage protocol is documented in `src/protocol.ts`.

## The pdfrx_web family

| Package | Role |
|---|---|
| [`@pdfrx/colab`](https://www.npmjs.com/package/@pdfrx/colab) | Collaborative React viewer, protocols, client, source adapter, and export composition. |
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
