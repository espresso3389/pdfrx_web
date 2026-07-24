# @pdfrx/react

React bindings for [pdfrx_web](https://github.com/espresso3389/pdfrx_web) — a
canvas-based PDF viewer for the browser.

`@pdfrx/viewer` gives you a viewer *class*; this package gives you a viewer
*component*, plus the thumbnail, outline and search UI that the class
deliberately leaves to the app.

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo-react/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_react.html)**

```sh
npm install @pdfrx/react
```

## Three layers

Pick the one that matches how much of the UI you want to own.

### 1. All-in-one

Toolbar, thumbnails/outline sidebar, search, print, form filling, and annotation
editing — the whole thing:

```tsx
import { PdfrxViewerApp } from '@pdfrx/react';
import '@pdfrx/react/styles.css';

<PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="/pdfium/" style={{ height: '100vh' }} enableFileOpen />;
```

`enableFileOpen` accepts picked **images** too — PNG, JPEG, GIF, WebP and friends
open as a one-page PDF. With `enablePageEditing`, dropping a PDF or image
**between two thumbnails** inserts its pages at that spot, and thumbnails can be
**dragged to reorder** the pages.

The standard annotation toolbar includes an **Add image** button. It adds the
selected image as a printable stamp annotation at the center of the current
page. The image is inserted at no more than 240 PDF points wide and is scaled
down proportionally again when necessary to remain within the page.

Dropping an image directly onto a displayed page creates the same stamp at the
drop point with the same sizing rules. Document opening remains an explicit
toolbar action, so page drops cannot accidentally replace the current document.

Static SVG drops keep paths and basic shapes as vector PDF appearance content,
including nested transforms, solid fills/strokes, opacity, and arc conversion.
SVG text, embedded images, CSS classes, gradients, patterns, clipping, masks,
filters, animation, and external references fall back to a raster appearance so
their visual result is preserved.

### 2. Composed parts

[`PdfrxProvider`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxProvider.html)
owns the viewer; where each piece goes is up to you. The only requirement is
exactly one
[`<PdfViewerSurface>`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfViewerSurface.html)
somewhere inside.

```tsx
import { PdfrxProvider, PdfSidebar, PdfToolbar, PdfViewerSurface } from '@pdfrx/react';
import '@pdfrx/react/styles.css';

<PdfrxProvider src="/manual.pdf" wasmModulesUrl="/pdfium/">
  <div className="pdfrx-app" style={{ height: '100vh' }}>
    <PdfToolbar />
    <div className="pdfrx-app-body">
      <PdfSidebar style={{ width: 190 }} />
      <PdfViewerSurface style={{ flex: 1 }} />
    </div>
  </div>
</PdfrxProvider>;
```

Individually available:
[`PdfToolbar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfToolbar.html),
[`PdfSidebar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSidebar.html),
[`PdfThumbnailList`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfThumbnailList.html),
[`PdfOutlineTree`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfOutlineTree.html),
[`PdfSearchBox`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSearchBox.html),
[`PdfPageIndicator`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfPageIndicator.html),
[`PdfZoomControls`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfZoomControls.html),
[`PdfPrintButton`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfPrintButton.html),
[`PdfLoadingBar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfLoadingBar.html),
[`PdfAnnotationToolbar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfAnnotationToolbar.html),
and
[`PdfSaveButton`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSaveButton.html).

### 3. Headless hooks

No components beyond the surface, no stylesheet — the UI is entirely yours.

```tsx
function Toolbar() {
  const { currentPageNumber, pageCount, goToNextPage, canGoNext } = usePdfNavigation();
  const { zoom, zoomIn } = usePdfZoom();
  const { query, setQuery, currentIndex, matchCount } = usePdfSearch();
  // …your markup
}
```

| Hook | What it gives you |
| --- | --- |
| [`usePdfrxViewer()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfrxViewer.html) | The underlying [`PdfrxViewer`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html) — the escape hatch for anything below |
| [`usePdfDocument()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfDocument.html) | Load state, page count, download progress, errors, [`open()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfDocumentState.html#open) |
| [`usePdfNavigation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfNavigation.html) | Current page, page count, `goToPage`/`goToDest` |
| [`usePdfZoom()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfZoom.html) | Zoom level, persistent explicit/page/width zoom mode, zoom/fit actions, whether the limits are reached |
| [`usePdfOutline()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfOutline.html) | The bookmark tree, reloaded per document |
| [`useFormFields()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useFormFields.html) | AcroForm fields, live values, loading state, and [`setValue()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfFormFieldsState.html#setvalue) |
| [`usePdfSearch()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfSearch.html) | Query, matches, current index, next/previous |
| [`usePdfSelection()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfSelection.html) | Selected range, resolved text and rects, copy |
| [`usePdfPageThumbnail()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfPageThumbnail.html) | One page rendered to a canvas, through a shared cache |
| [`usePdfPrint()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfPrint.html) | [`print()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPrint.html#print) plus an `isPrinting` flag |
| [`useAnnotations()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useAnnotations.html) | Annotation data and direct add/update/remove operations |
| [`useEditHistory()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useEditHistory.html) | Shared annotation/form/page-edit `undo`, `redo`, availability and `clearHistory` |

For an annotation-only collaboration viewer, disable page edits and local
Undo/Redo while attaching a stable user id to mutations:

```tsx
<PdfrxViewerApp
  src="/document.pdf"
  editing={{ annotations: true, pages: false, history: false, actorId: currentUser.id }}
/>
```

The annotation toolbar remains available, page-edit controls and history
buttons are hidden, and
[`viewer.setPages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpages) /
[`setPage()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpage)
reject edits. Subscribe to
[`document.addEventListener('annotationsChanged', ...)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#addeventlistener)
to publish its exact
`changes` batch. Apply an incoming batch with
[`document.applyAnnotationChanges(changes, { origin: 'remote', transactionId })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#applyannotationchanges);
the `origin` lets the publisher ignore it and avoid a synchronization echo.

The standard
[`PdfAnnotationToolbar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfAnnotationToolbar.html)
orders text controls after line thickness, provides independent text color and
font-size settings, and adds image stamps from its image picker. Picked images
are centered on the current page; dropped images use the drop point. Their
initial placement is capped at 240 PDF points wide and fitted to the page, but
that placement does not determine the embedded resolution: raster inputs retain
their decoded pixels up to a 2048-pixel longest side, and SVG inputs remain
vector paths. Repeated image resize operations reuse the retained source pixels
instead of progressively resampling PDFium's transformed appearance. Rectangle and
text-box tools share the same on-page behavior: placing a rectangle does not
automatically start typing, while double-clicking either a rectangle or
FreeText annotation opens localized inline editing. Adding non-blank text
converts the rectangle to FreeText; clearing all text converts it back to a
plain square. The inline editor follows the annotation stroke, text color,
font size, wrapping, and clipping while it is resized.

Secondary-button drag updates a marquee selection continuously during its drag.
Objects that leave the marquee are removed from the selection; holding
`Ctrl`/`Cmd` preserves the existing selection and adds intersecting objects.
The same modifier toggles objects on click. Straight lines and arrows are
clickable only near their actual segments (with a slightly wider touch target),
and a marquee must cross their segments rather than merely their bounding
rectangles. Annotation body and anchor drags
snap to nearby coordinates on other annotations and display alignment guides.

## Editing history and document mutations

The built-in annotation editor, form controls, and the page controls enabled by
`enablePageEditing` use one chronological Undo/Redo history. Page insertion,
deletion, rotation and thumbnail drag-reordering are each recorded as one
operation. `Ctrl`/`Cmd`+`Z`, `Ctrl`/`Cmd`+`Shift`+`Z` and `Ctrl`+`Y` follow that
same history, as do
[`undo()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfEditHistory.html#undo)
and
[`redo()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfEditHistory.html#redo)
returned by
[`useEditHistory()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useEditHistory.html).

Page history stores the complete page arrangement before and after an edit.
Undoing a page edit therefore restores the page numbering that existed when an
earlier annotation edit was recorded. This ordering is the invariant that keeps
annotation commands, which refer to 1-based page numbers, consistent.

For the standard rotate/delete UI, use
[`PdfPageActions`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfPageActions.html).
It performs local
viewer mutations by default, while collaborative hosts can intercept the same
controls and submit stable operations to their relay:

```tsx
<PdfPageActions
  pageNumber={pageNumber}
  rotationDeltas={[270, 90, 180]}
  onRotatePage={(page, delta) => submitRotate(page, delta)}
  onDeletePage={(page) => submitDelete(page)}
/>
```

When building other custom React page controls, either mutate through the viewer
returned by
[`usePdfrxViewer()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfrxViewer.html)
or call the attached document directly. Both
paths participate in the same history:

```tsx
const viewer = usePdfrxViewer();

function rotatePage(pageNumber: number) {
  const page = viewer?.document?.pages[pageNumber - 1];
  if (page) viewer?.setPage(pageNumber, page.rotatedCW90());
}

function deletePage(pageNumber: number) {
  const pages = viewer?.document?.pages;
  if (viewer && pages && pages.length > 1) {
    viewer.setPages(pages.filter((_, index) => index !== pageNumber - 1));
  }
}
```

```tsx
viewer.document?.setPage(pageNumber, page.rotatedCW90());
viewer.document?.setPages(nextPages);
```

`PdfDocument.pagesRearranged` carries both arrangements, while
`annotationsChanged.historyChanges` carries complete before/after annotation
specs. The viewer consumes those events for direct
[`PdfPage.addAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#addannotation),
[`updateAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#updateannotation)
and
[`removeAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html#removeannotation)
calls, including the `add`,
`update`, and `remove` functions from
[`useAnnotations()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useAnnotations.html).

Direct form writes also participate.
[`setFormFieldValues()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalues)
changes several inputs as one transaction, runs form calculations once, and
reports direct and calculated before/after values together, so the viewer records one Undo/Redo step. Changes
marked `remote`, `restore`, or `history` are applied and redrawn without entering
local history; page materialization is likewise excluded via its dedicated
`materialize` origin. Raw-object edits remain outside this model because they can
alter arbitrary PDF structures without semantic inverse operations.

Opening another document clears the history. For custom controls, use
[`useEditHistory()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useEditHistory.html):

```tsx
const { undo, redo, canUndo, canRedo, clearHistory } = useEditHistory();
```

[`undo()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfEditHistory.html#undo)
and
[`redo()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfEditHistory.html#redo)
are asynchronous because an entry may contain annotation
or form writes; await them before starting another programmatic edit.

### Saving, page assembly and history

Undo/Redo page entries retain the
[`PdfPage`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPage.html)
proxies from before and after each
operation.
[`PdfDocument.assemblePages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#assemblepages)
replaces the PDF's physical page tree
and reloads its pages, so those saved proxies can no longer be used to restore
the earlier arrangement reliably.
[`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
calls
[`assemblePages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#assemblepages)
automatically and has the same consequence. Calling either while retaining the
history can therefore leave Undo/Redo inconsistent with the live document.

The built-in download buttons avoid this by using
[`PdfDocument.encodePdfCopy()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdfcopy).
Assembly happens on a temporary document, while
the live document and its history remain intact. Custom editor save UI should
normally do the same:

```tsx
await viewer.flushAnnotationTextEdit();
const data = await viewer.document!.encodePdfCopy();
```

[`PdfSaveButton`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSaveButton.html)
accepts an
[`encode(document)`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfSaveButtonProps.html#encode)
override when an application must
post-process the bytes—for example, to merge outlines and AcroForm catalogs
from several source PDFs. The default remains
[`document.encodePdfCopy()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdfcopy):

```tsx
<PdfSaveButton encode={(document) => exportVirtualDocument(document, session)} />
```

The engine preserves document-level structures from a sole imported source. A
mixed-source arrangement needs an application-specific merge policy for field
name collisions, outline destinations, calculation order, signatures, and
other catalog entries; page import alone cannot decide those semantics.

The temporary native document and its encoded buffers increase peak memory
usage during the save. For memory-constrained applications, it can instead be
reasonable to make assembly an explicit, irreversible history boundary: clear
the history first, then encode the live document.

```tsx
const { clearHistory } = useEditHistory();

await viewer.flushAnnotationTextEdit();
clearHistory();                 // The current state becomes the new baseline.
const data = await viewer.document!.encodePdf(); // Assembles the live document.
```

Clearing first is important. Do not call
[`assemblePages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#assemblepages)
or
[`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
and then leave older Undo/Redo entries available.

## Two things your app must provide

1. **The engine's WASM assets.** Point `wasmModulesUrl` at a directory holding
   `pdfium_worker.js` and `pdfium.wasm` — copy them from
   `node_modules/@pdfrx/engine/assets/`, or use the CDN:

   ```tsx
   <PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.14.0/assets/" />
   ```

2. **CORS for remote PDFs**, since the document is fetched like any other
   resource.

## Localization

The built-in components ship with English, Japanese, Simplified and Traditional
Chinese, French and German. By default the language is auto-detected from the
browser (`navigator.languages`); English is the fallback.

```tsx
// Auto-detect from the browser (default — no prop needed)
<PdfrxViewerApp src="/manual.pdf" />

// Force a language
<PdfrxViewerApp src="/manual.pdf" locale="ja" />

// Priority list; first supported wins, else English
<PdfrxViewerApp src="/manual.pdf" locale={['fr-CA', 'fr', 'en']} />
```

Override individual strings, or add a language that isn't built in, with
`strings` (applied on top of `locale`; anything you omit falls back to English):

```tsx
<PdfrxViewerApp
  src="/manual.pdf"
  locale="es"                          // not built in → English base
  strings={{ search: 'Buscar', pagesTab: 'Páginas', print: 'Imprimir' }}
/>
```

The full string set is the
[`PdfrxStrings`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxStrings.html)
interface;
[`usePdfrxStrings()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfrxStrings.html)
gives
your own components the active strings so they translate alongside the rest.

## Context menu

The right-click / long-press menu (Copy / Select All / Highlight) is themed and
localized out of the box. Highlight opens a color palette when text can be
converted to a markup annotation. Pass `contextMenuBuilder` to customize it — it receives the
event context plus `{ viewer, strings }`, so you can reuse the built-in
[`buildDefaultContextMenu`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.buildDefaultContextMenu.html)
and append your own items:

```tsx
import { PdfrxViewerApp, buildDefaultContextMenu } from '@pdfrx/react';

<PdfrxViewerApp
  src="/manual.pdf"
  contextMenuBuilder={(context, { viewer, strings }) => {
    // Start from the default localized Copy / Select All / Highlight menu…
    const menu = buildDefaultContextMenu(viewer, strings, context);

    // …then add your own item (reuse the built-in classes for the styling).
    const item = document.createElement('button');
    item.className = 'pdfrx-context-menu-item';
    item.textContent = 'Search the web';
    item.disabled = !context.hasSelection;
    item.addEventListener('click', async () => {
      context.close();
      const text = await viewer.selection.getSelectedText();
      if (text) window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
    });
    menu.appendChild(item);

    return menu; // the viewer positions and dismisses it
  }}
/>;
```

Return `null` to suppress the menu entirely, or build a completely custom
element instead of calling
[`buildDefaultContextMenu`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.buildDefaultContextMenu.html).

## Theming

`styles.css` is driven by custom properties, so overriding a handful of
variables is usually enough:

```css
.pdfrx-app {
  --pdfrx-accent: #7c3aed;
  --pdfrx-radius: 10px;
  --pdfrx-thumb-width: 150px;
}
```

The dark palette follows `prefers-color-scheme` by default.

## Notes

- **Server rendering** is safe: nothing touches the DOM until
  [`PdfViewerSurface`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfViewerSurface.html)
  mounts, and the viewer is created there.
- **StrictMode** double-mounts every effect in development. The provider defers
  teardown by a microtask so the immediate remount reclaims the same viewer
  rather than booting a second pdfium worker.
- **The viewer owns its document.** Any
  [`PdfDocument`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfDocument.html) /
  [`PdfPage`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPage.html)
  you hold via
  [`usePdfrxViewer()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfrxViewer.html)
  becomes invalid when another document is opened — re-read it, or key your
  state on
  [`useDocumentGeneration()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useDocumentGeneration.html).
- **Options are live.** Changing `backgroundColor`, `panEnabled`,
  `layoutDirection` and friends applies to the running viewer. `engine`,
  `engineOptions` and `initialFit` are read once at construction, so changing
  those requires remounting the provider.

## The pdfrx_web family

| Package | Role |
|---|---|
| [`@pdfrx/colab`](https://www.npmjs.com/package/@pdfrx/colab) | Collaborative React viewer, protocols, client, source adapter, and export composition. |
| **`@pdfrx/react`** (this package) | React components and hooks over `@pdfrx/viewer`. |
| [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) | Framework-agnostic `<canvas>` viewer + `<pdfrx-viewer>` element. |
| [`@pdfrx/viewer-core`](https://www.npmjs.com/package/@pdfrx/viewer-core) | DOM-free geometry / layout / selection logic. |
| [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) | Typed client for the WASM rendering worker. |

Full [API reference](https://espresso3389.github.io/pdfrx_web/) ·
[repository](https://github.com/espresso3389/pdfrx_web) ·
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)

## License

MIT
