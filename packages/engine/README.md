# @pdfrx/engine

Typed TypeScript access to the PDFium WASM worker used by the pdfrx_web viewer
packages. Use it directly for PDF rendering, text and link extraction, forms,
annotations, page editing, or PDF encoding without a viewer UI. It supports
browsers, Node.js, Bun, and Deno.

**[npm package](https://www.npmjs.com/package/@pdfrx/engine)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_engine.html)** ·
**[Detailed guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ENGINE-GUIDE.md)**

## Highlights

- Worker-backed PDFium rendering keeps PDF processing off the calling thread.
- Full-page and partial-region rendering supports high-resolution and tiled
  viewers, with cancellation before queued work starts.
- Text extraction includes per-character geometry; links, outlines, forms, and
  annotations are exposed as typed data.
- Annotation, form, outline, and page-arrangement edits can be encoded back to
  PDF, including non-destructive copy encoding.
- Batched page-content authoring creates or inserts pages containing embedded
  text, raster images, and vector paths in one worker round trip.
- Mixed-script FreeText preparation handles grapheme-safe wrapping, CJK
  language hints, and cross-runtime emoji appearances with configurable asset,
  renderer, and cache services.
- HTTP range access can avoid downloading an entire remote PDF up front.
- The same API runs in browsers, Node.js, Bun, and Deno.
- Password callbacks, custom font registration, and raw PDF-object inspection
  cover advanced document workflows.

## Install

```sh
npm install @pdfrx/engine
```

## Minimal usage

```ts
import { PdfrxEngine } from '@pdfrx/engine';

const engine = new PdfrxEngine({
  wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.25.1/assets/',
});
const document = await engine.openUrl('/manual.pdf');
const page = document.pages[0];

if (page) {
  const image = await page.render({
    fullWidth: page.width * 2,
    fullHeight: page.height * 2,
  });
  if (image) canvasContext.putImageData(image.toImageData(), 0, 0);
}

await document.dispose();
engine.dispose();
```

In browsers, `wasmModulesUrl` must point to a directory containing
`pdfium_worker.js` and `pdfium.wasm`. Copy both from
`node_modules/@pdfrx/engine/assets/` or serve the versioned CDN directory shown
above. Non-browser runtimes discover the installed assets automatically.

## API overview

### Open a document

[`PdfrxEngine`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html)
owns the worker and opens
[`PdfDocument`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html)
instances:

- [`openUrl()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#openurl)
  opens a remote PDF, optionally using HTTP range access and a password
  callback.
- [`openData()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata)
  opens bytes supplied as an `ArrayBuffer`, typed array, or compatible binary
  source.

### Create a document

The same
[`PdfrxEngine`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html)
creates new
[`PdfDocument`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html)
instances from an empty document, images, or declarative page contents:

- [`createNew()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createnew)
  creates an empty document.
- [`createFromImages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createfromimages)
  creates one PDF page per supplied image.
- [`createFromPageContents()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createfrompagecontents)
  creates complete pages from declarative
  [`PdfPageContentSpec`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfPageContentSpec.html)
  values containing text, image, and vector-path objects;
  [`insertPageContents()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#insertpagecontents)
  inserts one or more of those pages at a zero-based position. See the
  page-content guide below.

### Render and inspect pages

Documents expose their current page arrangement through
[`PdfDocument.pages`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#pages).
Each
[`PdfPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html)
provides:

- [`render()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#render)
  for full-page or partial-region RGBA rendering.
- [`loadText()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadtext)
  for text plus per-character PDF-coordinate rectangles.
- [`loadLinks()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadlinks)
  and
  [`loadAnnotations()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#loadannotations)
  for interactive page content.

At document scope,
[`loadOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadoutline)
reads bookmarks and
[`loadFormFields()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#loadformfields)
reads AcroForm controls and their values.

### Edit document state

- [`setPages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages)
  and
  [`setPage()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage)
  arrange, import, duplicate, remove, or rotate pages without immediately
  rewriting the physical page tree.
- [`addAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#addannotation),
  [`updateAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#updateannotation),
  and
  [`removeAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#removeannotation)
  modify page annotations.
- [`prepareFreeTextAppearance()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#preparefreetextappearance-1)
  prepares wrapping, mixed-script font runs, and emoji images before a
  FreeText annotation is added or updated. Its
  [`PdfTextAppearanceServices`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfTextAppearanceServices.html)
  can replace measurement, font resolution, or emoji rendering.
- [`setFormFieldValue()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalue)
  and
  [`setFormFieldValues()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalues)
  update form controls and run supported calculations.
- [`setOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setoutline)
  replaces the logical bookmark tree.

Document mutation events report page, annotation, and form changes with origin,
transaction, and actor metadata, allowing applications to build persistence,
history, or synchronization without polling.

### Local fonts on Node, Bun, and Deno

Server runtimes can explicitly opt into local filesystem fonts:

```ts
const engine = new PdfrxEngine({
  localFonts: {
    systemDirectories: true,
    directories: ['./fonts'],
  },
  fontCache: {
    directory: './.cache/pdfrx-fonts',
    persistRegisteredFonts: true,
  },
});
```

[`PdfrxLocalFontsOptions`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfrxLocalFontsOptions.html)
controls OS and application font directories. The engine indexes internal font
names and lazily loads missing faces.
[`PdfrxFontCacheOptions`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfrxFontCacheOptions.html)
caches that index and can optionally persist bytes passed to `addFontData()`.
Persisting font bytes is disabled by default so the application can enforce its
font licenses and data-handling policy. Deno requires matching filesystem
permissions.

### Encode and dispose

[`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
returns PDF bytes. Its copy mode materializes a temporary document so the live
document and page proxies remain usable; compact mode rebuilds reachable
page-level content with lower retention of document-level structures. The
default live-document materialization is an explicit state boundary, so consult
the guide before combining it with application Undo/Redo.

Dispose every document with
[`PdfDocument.dispose()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#dispose)
and dispose the engine when finished. In Node.js, the engine worker otherwise
keeps the process alive.

## Next steps

- The [engine guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ENGINE-GUIDE.md)
  covers non-browser use, rendering, editing, events, encoding, and advanced
  worker configuration.
- The [text, language, and emoji guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/TEXT-APPEARANCE.md)
  covers automatic Noto fallback, caching, offline assets, and custom
  renderers.
- The [page-content authoring guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/PAGE-CONTENTS.md)
  covers coordinate conventions, fonts, binary ownership, images, and batched
  page insertion.
- The [`PdfrxEngine` API](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html)
  lists all open/create methods and engine options.
- Related packages:
  [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) ·
  [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) ·
  [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react)

## License

MIT
