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

Drop an image directly onto a displayed page to add it as a printable stamp
annotation. Document opening remains an explicit toolbar action, so page drops
cannot accidentally replace the current document.

### 2. Composed parts

`PdfrxProvider` owns the viewer; where each piece goes is up to you. The only
requirement is exactly one `<PdfViewerSurface>` somewhere inside.

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

Individually available: `PdfToolbar`, `PdfSidebar`, `PdfThumbnailList`,
`PdfOutlineTree`, `PdfSearchBox`, `PdfPageIndicator`, `PdfZoomControls`,
`PdfPrintButton`, `PdfLoadingBar`, `PdfAnnotationToolbar`, and `PdfSaveButton`.

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
| `usePdfrxViewer()` | The underlying `PdfrxViewer` — the escape hatch for anything below |
| `usePdfDocument()` | Load state, page count, download progress, errors, `open()` |
| `usePdfNavigation()` | Current page, page count, `goToPage`/`goToDest` |
| `usePdfZoom()` | Zoom level, zoom/fit actions, whether the limits are reached |
| `usePdfOutline()` | The bookmark tree, reloaded per document |
| `useFormFields()` | AcroForm fields, live values, loading state, and `setValue()` |
| `usePdfSearch()` | Query, matches, current index, next/previous |
| `usePdfSelection()` | Selected range, resolved text and rects, copy |
| `usePdfPageThumbnail()` | One page rendered to a canvas, through a shared cache |
| `usePdfPrint()` | `print()` plus an `isPrinting` flag |
| `useAnnotations()` | Annotation data and direct add/update/remove operations |
| `useEditHistory()` | Shared annotation/form/page-edit `undo`, `redo`, availability and `clearHistory` |

For an annotation-only collaboration viewer, disable page edits and local
Undo/Redo while attaching a stable user id to mutations:

```tsx
<PdfrxViewerApp
  src="/document.pdf"
  editing={{ annotations: true, pages: false, history: false, actorId: currentUser.id }}
/>
```

The annotation toolbar remains available, page-edit controls and history
buttons are hidden, and `viewer.setPages()` / `setPage()` reject edits. Subscribe
to `document.addEventListener('annotationsChanged', ...)` to publish its exact
`changes` batch. Apply an incoming batch with
`document.applyAnnotationChanges(changes, { origin: 'remote', transactionId })`;
the `origin` lets the publisher ignore it and avoid a synchronization echo.

The standard annotation toolbar orders text controls after line thickness and
provides independent text color and font-size settings. Rectangle and text-box
tools share the same on-page behavior: placing a rectangle does not
automatically start typing, while double-clicking either a rectangle or
FreeText annotation opens localized inline editing. Adding non-blank text
converts the rectangle to FreeText; clearing all text converts it back to a
plain square. The inline editor follows the annotation stroke, text color,
font size, wrapping, and clipping while it is resized.

Object-select mode updates a marquee selection continuously during its drag.
Objects that leave the marquee are removed from the selection; holding
`Ctrl`/`Cmd` preserves the existing selection and adds intersecting objects.
The same modifier toggles objects on click. Annotation body and anchor drags
snap to nearby coordinates on other annotations and display alignment guides.

## Editing history and document mutations

The built-in annotation editor, form controls, and the page controls enabled by
`enablePageEditing` use one chronological Undo/Redo history. Page insertion,
deletion, rotation and thumbnail drag-reordering are each recorded as one
operation. `Ctrl`/`Cmd`+`Z`, `Ctrl`/`Cmd`+`Shift`+`Z` and `Ctrl`+`Y` follow that
same history, as do `undo()` and `redo()` returned by `useEditHistory()`.

Page history stores the complete page arrangement before and after an edit.
Undoing a page edit therefore restores the page numbering that existed when an
earlier annotation edit was recorded. This ordering is the invariant that keeps
annotation commands, which refer to 1-based page numbers, consistent.

For the standard rotate/delete UI, use `PdfPageActions`. It performs local
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
returned by `usePdfrxViewer()` or call the attached document directly. Both
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
specs. The viewer consumes those events for direct `PdfPage.addAnnotation()`,
`updateAnnotation()` and `removeAnnotation()` calls, including the `add`,
`update`, and `remove` functions from `useAnnotations()`.

Direct form writes also participate.
[`setFormFieldValues()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalues)
changes several inputs as one transaction, runs form calculations once, and
reports direct and calculated before/after values together, so the viewer records one Undo/Redo step. Changes
marked `remote`, `restore`, or `history` are applied and redrawn without entering
local history; page materialization is likewise excluded via its dedicated
`materialize` origin. Raw-object edits remain outside this model because they can
alter arbitrary PDF structures without semantic inverse operations.

Opening another document clears the history. For custom controls, use
`useEditHistory()`:

```tsx
const { undo, redo, canUndo, canRedo, clearHistory } = useEditHistory();
```

`undo()` and `redo()` are asynchronous because an entry may contain annotation
or form writes; await them before starting another programmatic edit.

### Saving, page assembly and history

Undo/Redo page entries retain the `PdfPage` proxies from before and after each
operation. `PdfDocument.assemblePages()` replaces the PDF's physical page tree
and reloads its pages, so those saved proxies can no longer be used to restore
the earlier arrangement reliably. `encodePdf()` calls `assemblePages()`
automatically and has the same consequence. Calling either while retaining the
history can therefore leave Undo/Redo inconsistent with the live document.

The built-in download buttons avoid this by using
`PdfDocument.encodePdfCopy()`. Assembly happens on a temporary document, while
the live document and its history remain intact. Custom editor save UI should
normally do the same:

```tsx
await viewer.flushAnnotationTextEdit();
const data = await viewer.document!.encodePdfCopy();
```

`PdfSaveButton` accepts an `encode(document)` override when an application must
post-process the bytes—for example, to merge outlines and AcroForm catalogs
from several source PDFs. The default remains `document.encodePdfCopy()`:

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

Clearing first is important. Do not call `assemblePages()` or `encodePdf()` and
then leave older Undo/Redo entries available.

## Two things your app must provide

1. **The engine's WASM assets.** Point `wasmModulesUrl` at a directory holding
   `pdfium_worker.js` and `pdfium.wasm` — copy them from
   `node_modules/@pdfrx/engine/assets/`, or use the CDN:

   ```tsx
   <PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.12.0/assets/" />
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

The full string set is the `PdfrxStrings` interface; `usePdfrxStrings()` gives
your own components the active strings so they translate alongside the rest.

## Context menu

The right-click / long-press menu (Copy / Select All / Highlight) is themed and
localized out of the box. Highlight opens a color palette when text can be
converted to a markup annotation. Pass `contextMenuBuilder` to customize it — it receives the
event context plus `{ viewer, strings }`, so you can reuse the built-in
`buildDefaultContextMenu` and append your own items:

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
element instead of calling `buildDefaultContextMenu`.

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
  `PdfViewerSurface` mounts, and the viewer is created there.
- **StrictMode** double-mounts every effect in development. The provider defers
  teardown by a microtask so the immediate remount reclaims the same viewer
  rather than booting a second pdfium worker.
- **The viewer owns its document.** Any `PdfDocument`/`PdfPage` you hold via
  `usePdfrxViewer()` becomes invalid when another document is opened — re-read
  it, or key your state on `useDocumentGeneration()`.
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
