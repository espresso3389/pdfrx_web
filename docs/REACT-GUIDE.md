# @pdfrx/react guide

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

Two-page layout switching, rectangular capture, marquee zoom, and browser
fullscreen controls are available as standalone components for composed
layouts:

```tsx
<PdfToolbar>
  <PdfSpreadButton />
  <PdfMarqueeZoomButton />
  <PdfCaptureAreaButton onCapture={(blob) => uploadPreview(blob)} />
  <PdfFullscreenButton />
</PdfToolbar>
```

`PdfCaptureAreaButton` downloads `capture.png` when `onCapture` is omitted.
Its active state remains highlighted through both area selection and image
encoding. Escape cancels capture or marquee zoom.

Print, spread switching, capture, and marquee zoom are deliberately hidden in
the standard app. They compete for limited toolbar space, and capture is often
an application workflow rather than a general viewer action. Enable only the
ones the application needs:

```tsx
<PdfrxViewerApp
  src="/manual.pdf"
  features={{
    print: true,
    spread: true,
    // capture: true,
    // marqueeZoom: true,
  }}
/>
```

Supported groups include `sidebar`, `search`, `zoom`, `print`, `open`,
`download`, `annotations`, `pageEditing`, `history`, `fullscreen`, `spread`,
`capture`, and `marqueeZoom`. The four opt-in groups above default to `false`;
the other groups default to `true` and can be hidden explicitly. This controls
the standard app chrome; composed or headless consumers remain responsible for
their own controls. `PdfToolbar` also hides print by default; pass
`showPrint={true}` when composing it directly.

PDF permission flags are applied after these application choices. The standard
print entry disappears when printing is forbidden, page actions are removed
when document assembly is forbidden, and annotation/form editing is disabled
when annotation modification is forbidden. Read the resolved state from
`usePdfDocument()`:

```tsx
const {
  isCopyAllowed,
  isPrintAllowed,
  isDocumentAssemblyAllowed,
  isAnnotationEditingAllowed,
} = usePdfDocument();
```

`permissionOverrides` and `enforceDocumentPermissions` are accepted by
`PdfrxProvider` and `PdfrxViewerApp` when an application policy needs to
override the PDF's advisory flags.

The annotation toolbar, narrow-screen search row, and dismissible error banner
animate as they enter and leave the layout. The default stylesheet disables
these transitions when the user requests reduced motion.

For application-controlled editing behavior, `renderContent` can retain the
standard viewer chrome while selectively overriding file, page, and export
operations through
[`PdfrxViewerAppOverrides`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html);
its
[`onSaveError`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#onsaveerror)
callback lets a host surface export failures in application UI.
See [Customizing `PdfrxViewerApp`](https://github.com/espresso3389/pdfrx_web/blob/master/docs/REACT-VIEWER-APP-CUSTOMIZATION.md)
for the complete pattern.

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
import {
  PdfrxProvider,
  PdfSidebar,
  PdfToolbar,
  PdfViewerSurface,
  useImageAnnotationDrop,
} from '@pdfrx/react';
import '@pdfrx/react/styles.css';

function ViewerSurface() {
  const imageDrop = useImageAnnotationDrop();
  return <PdfViewerSurface style={{ flex: 1 }} {...imageDrop} />;
}

<PdfrxProvider src="/manual.pdf" wasmModulesUrl="/pdfium/">
  <div className="pdfrx-app" style={{ height: '100vh' }}>
    <PdfToolbar />
    <div className="pdfrx-app-body">
      <PdfSidebar style={{ width: 190 }} />
      <ViewerSurface />
    </div>
  </div>
</PdfrxProvider>;
```

[`useImageAnnotationDrop()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useImageAnnotationDrop.html)
adds the all-in-one viewer's standard drop-to-insert image behavior to a
composed surface. Local annotation change listeners observe the resulting
stamp normally, so host applications do not need to reimplement file
classification, canvas hit testing, or image decoding.

Individually available:
[`PdfToolbar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfToolbar.html),
[`PdfSidebar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSidebar.html),
[`PdfViewerLayout`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfViewerLayout.html),
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

Printing is intentionally unavailable on iOS and iPadOS because WebKit can
replace a correct PDF-page preview with a screenshot of the complete viewer UI.
The standard [`PdfPrintButton`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfPrintButton.html)
is therefore omitted on those platforms. Custom toolbars should check
[`usePdfPrint().isSupported`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPrint.html#issupported)
before exposing their print action. Saving or downloading the edited PDF
remains supported and is the recommended iOS/iPadOS alternative.

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
| [`usePdfPrint()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfPrint.html) | [`print()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPrint.html#print), `isPrinting`, and [`isSupported`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPrint.html#issupported); printing is unsupported on iOS/iPadOS |
| [`useAnnotations()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useAnnotations.html) | Annotation data and direct add/update/remove operations |
| [`useEditHistory()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.useEditHistory.html) | Shared annotation/form/page-edit `undo`, `redo`, availability and `clearHistory` |

Editing capabilities can be enabled independently. For example, an
annotation-only viewer can disable page edits and history while attaching an
application-defined actor id to mutations:

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
reject edits. Annotation changes expose complete mutation batches through
[`document.addEventListener('annotationsChanged', ...)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#addeventlistener)
and can be reapplied with
[`document.applyAnnotationChanges(changes, { origin: 'remote', transactionId })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#applyannotationchanges);
`origin`, `transactionId`, and `actorId` provide application-defined mutation
metadata for persistence, synchronization, and event filtering.

The standard
[`PdfAnnotationToolbar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfAnnotationToolbar.html)
provides creation, selection, and common property controls for annotations.
See [Annotation toolbar and object editing](https://github.com/espresso3389/pdfrx_web/blob/master/docs/REACT-ANNOTATION-TOOLBAR.md)
for its tools, selection gestures, text editing, image handling, and property
controls.

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
It performs viewer mutations by default. Supply callbacks when page operations
must be handled by another state-management or persistence layer:

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

### Saving, materialization and history

Undo/Redo page entries retain the
[`PdfPage`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfPage.html)
proxies from before and after each
operation.
[`PdfDocument.materialize()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#materialize)
writes pending document edits and replaces the PDF's physical page tree
and reloads its pages, so those saved proxies can no longer be used to restore
the earlier arrangement reliably.
[`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
calls
[`materialize()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#materialize)
automatically and has the same consequence. Calling either while retaining the
history can therefore leave Undo/Redo inconsistent with the live document.

The built-in download buttons avoid this by using
[`PdfDocument.encodePdf({ mode: 'copy' })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf).
Materialization happens on a temporary document, while
the live document and its history remain intact. While encoding, their download
icon changes to a busy indicator and the button exposes `aria-busy="true"`.
Custom editor save UI should normally do the same:

```tsx
await viewer.flushAnnotationTextEdit();
const data = await viewer.document!.encodePdf({ mode: 'copy' });
```

[`PdfSaveButton`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSaveButton.html)
accepts an
[`encode(document)`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfSaveButtonProps.html#encode)
override when an application must post-process the bytes—for example, to apply
an application-specific export policy. The default remains
[`document.encodePdf({ mode: 'copy' })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf):

```tsx
<PdfSaveButton encode={(document) => exportDocument(document, exportOptions)} />
```

The engine preserves document-level structures from a sole imported source. A
mixed-source arrangement needs an application-specific merge policy for field
name collisions, outline destinations, calculation order, signatures, and
other catalog entries; page import alone cannot decide those semantics.

The temporary native document and its encoded buffers increase peak memory
usage during the save. A PDF that may contain unreachable page-level objects
can use
[`encodePdf({ mode: 'compact' })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
to rebuild only its reachable page-level objects. Pending logical page,
outline, and Link edits are written to the temporary document, but existing
physical document-level outlines, metadata, name trees, signatures, and
AcroForm configuration are not inherited and require application-level
reconstruction when needed. Alternatively, a memory-constrained application can make
materialization an explicit, irreversible history boundary: clear the history first,
then encode the live document.

```tsx
const { clearHistory } = useEditHistory();

await viewer.flushAnnotationTextEdit();
clearHistory();                 // The current state becomes the new baseline.
const data = await viewer.document!.encodePdf(); // Materializes the live document.
```

Clearing first is important. Do not call
[`materialize()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#materialize)
or
[`encodePdf()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#encodepdf)
and then leave older Undo/Redo entries available.

## Two things your app must provide

1. **The engine's WASM assets.** Point `wasmModulesUrl` at a directory holding
   `pdfium_worker.js` and `pdfium.wasm` — copy them from
   `node_modules/@pdfrx/engine/assets/`, or use the CDN:

```tsx
<PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.22.2/assets/" />
```

2. **CORS for remote PDFs**, since the document is fetched like any other
   resource.

## Localization

The built-in components ship with English, Japanese, Simplified and Traditional
Chinese, French and German. By default the language is auto-detected from the
browser (`navigator.languages`); English is the fallback.

The UI locale also supplies the default language hint for mixed-script
FreeText, notably Han-only text. This does not change PDF text extraction.
FreeText grapheme, CJK-font, and emoji appearance handling is implemented by
`@pdfrx/engine`; see
[Text, language, and emoji appearance](TEXT-APPEARANCE.md).

```tsx
// Auto-detect from the browser (default — no prop needed)
<PdfrxViewerApp src="/manual.pdf" />

// Force a language
<PdfrxViewerApp src="/manual.pdf" locale="ja" />

// Priority list; first supported wins, else English
<PdfrxViewerApp src="/manual.pdf" locale={['fr-CA', 'fr', 'en']} />
```

### Adjusting individual translations

Use the `strings` prop to replace only the labels that need different wording.
The provider first resolves the built-in dictionary for `locale`, then applies
the supplied keys on top:

```text
built-in strings for locale → strings overrides
```

Omitted keys therefore keep the selected locale's built-in translation. For
example, this viewer remains Japanese except for the three adjusted labels:

```tsx
import { PdfrxViewerApp, type PdfrxStrings } from '@pdfrx/react';

const stringOverrides: Partial<PdfrxStrings> = {
  search: '文書内を検索',
  pagesTab: 'ページ一覧',
  print: '印刷する',
};

<PdfrxViewerApp
  src="/manual.pdf"
  locale="ja"
  strings={stringOverrides}
/>;
```

`PdfrxProvider` accepts the same `locale` and `strings` props when using the
composable API. Declare overrides as `Partial<PdfrxStrings>` to have TypeScript
check the property names and value signatures without requiring the complete
dictionary.

Strings that interpolate runtime values are functions rather than fixed text:

```tsx
const stringOverrides: Partial<PdfrxStrings> = {
  goToPage: (pageNumber) => `${pageNumber}ページへ移動`,
  failedToOpen: (message) => `PDFを開けませんでした: ${message}`,
  failedToImport: (fileName, message) =>
    `${fileName}を読み込めませんでした: ${message}`,
};
```

The override object participates in the localization context's memoization.
Keep it at module scope, as above, or create it with `useMemo()` when its values
depend on component state. An inline object is valid, but creates a new context
value on every parent render.

The same mechanism can supply part or all of a language that is not built in.
An unsupported `locale` resolves to the English dictionary first, so omitted
keys in this case remain English:

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
gives custom components the final merged strings so they translate alongside
the built-in UI:

```tsx
import { usePdfrxStrings } from '@pdfrx/react';

function CustomPrintButton() {
  const strings = usePdfrxStrings();
  return <button>{strings.print}</button>;
}
```

## Context menu

The right-click / long-press menu (Copy / Select All / Markup / Add link) is
themed and localized out of the box. Markup is a split action: its main button
reapplies the most recently used markup style for that viewer, while its arrow
opens a matrix whose rows are Highlight, Underline, Squiggly, and StrikeOut and
whose columns are colors. Hovering a cell (or focusing it with the keyboard)
previews that exact subtype and color over the current selection without
changing the PDF; clicking the cell commits it.

Highlight uses the pastel
[`TEXT_HIGHLIGHT_COLORS`](https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_react.TEXT_HIGHLIGHT_COLORS.html)
at
[`TEXT_HIGHLIGHT_OPACITY`](https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_react.TEXT_HIGHLIGHT_OPACITY.html).
Underline, Squiggly, and StrikeOut use the darker
[`TEXT_MARKUP_LINE_COLORS`](https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_react.TEXT_MARKUP_LINE_COLORS.html)
at full opacity so the strokes remain legible. These exported constants let
custom menus use the same defaults.

Add link opens the standard link-target editor and converts each selected visual
line into a Link annotation. It uses
[`PdfrxViewer.addLinkToSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addlinktoselection-1),
gated by
[`canAddLinkToSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#canaddlinktoselection-1).
Pass `contextMenuBuilder` to customize it — it receives the
event context plus `{ viewer, strings }`, so you can reuse the built-in
[`buildDefaultContextMenu`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.buildDefaultContextMenu.html)
and append your own items:

```tsx
import { PdfrxViewerApp, buildDefaultContextMenu } from '@pdfrx/react';

<PdfrxViewerApp
  src="/manual.pdf"
  contextMenuBuilder={(context, { viewer, strings }) => {
    // Start from the default localized Copy / Select All / Markup / Add link menu…
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
  [`autoLinkDetection`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#autolinkdetection),
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
