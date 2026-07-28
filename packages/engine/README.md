# @pdfrx/engine

Typed TypeScript access to the PDFium WASM worker used by the pdfrx_web viewer
packages. Use it directly for PDF rendering, text and link extraction, forms,
annotations, page editing, or PDF encoding without a viewer UI. It supports
browsers, Node.js, Bun, and Deno.

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
  wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.22.3/assets/',
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

### Open or create a document

[`PdfrxEngine`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html)
owns the worker and creates
[`PdfDocument`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html)
instances:

- [`openUrl()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#openurl)
  opens a remote PDF, optionally using HTTP range access and a password
  callback.
- [`openData()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#opendata)
  opens bytes supplied as an `ArrayBuffer`, typed array, or compatible binary
  source.
- [`createNew()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createnew)
  creates an empty document.
- [`createFromImages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html#createfromimages)
  creates one PDF page per supplied image.

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
- The [`PdfrxEngine` API](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfrxEngine.html)
  lists all open/create methods and engine options.
- Use [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) for a
  framework-agnostic canvas viewer or
  [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) for ready-made
  React UI.

## License

MIT
