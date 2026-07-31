# @pdfrx/viewer guide

A canvas-based PDF viewer component for the browser. It renders pages, text
selection, links, and search highlights onto a single `<canvas>`, and ships as
a framework-agnostic custom element or a plain class.

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_viewer.html)**

- Sharp, high-quality rendering with re-rendering on zoom
- Pan/select text by primary-button drag in normal mode; in annotation mode the
  same button edits objects/anchors or marquee-selects empty space
- Canvas-painted text selection: mouse drag, double-click word selection,
  touch long-press with draggable handles and a magnifier lens
- Text search with highlights, outline (bookmarks), page thumbnails
- Links (external URLs and internal destinations), context menu, clipboard
- Printing
- Automatic missing-font fallback via Google Fonts
- Password-protected documents
- Single-page, horizontal, and odd/even two-page book layouts
- Rectangular page capture and marquee zoom
- Interactive AcroForm filling through accessible native HTML controls
- SVG annotation editing: ink, shapes, notes/free text, text markup,
  live marquee multi-selection, duplication, snapping guides, and undo/redo
- Built-in loading spinner/progress bar with observable loading state

## Installation

```sh
npm install @pdfrx/viewer
```

## Usage

As a custom element:

```html
<script type="module">
  import { definePdfrxViewerElement } from '@pdfrx/viewer';
  definePdfrxViewerElement();
</script>

<pdfrx-viewer
  src="/documents/manual.pdf"
wasm-modules-url="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.24.0/assets/"
  style="width: 100%; height: 100vh"
></pdfrx-viewer>
```

Or programmatically:

```ts
import { PdfrxViewer } from '@pdfrx/viewer';

const viewer = new PdfrxViewer(document.getElementById('container')!, {
  engineOptions: {
  wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.24.0/assets/',
  },
});
await viewer.openUrl('/documents/manual.pdf');

viewer.goToPage(3);
const searcher = viewer.createTextSearcher();
searcher.startTextSearch('keyword');
console.log(viewer.selectedText);
await viewer.print();
```

[`wasmModulesUrl`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfrxEngineOptions.html#wasmmodulesurl) must point at a directory containing `pdfium_worker.js` and
`pdfium.wasm`. Use the jsDelivr URL above, or self-host by copying them from
`node_modules/@pdfrx/engine/assets/`. Remote PDFs are fetched with `fetch`,
so cross-origin documents need CORS headers.

Browser printing is supported on desktop platforms. It is intentionally
unsupported on iOS and iPadOS: WebKit may initially show the rasterized PDF
pages and then replace the preview with a snapshot of the complete viewer UI.
Rather than open a misleading preview, `print()` throws on those platforms.
Applications should offer PDF download/save instead.

## Waiting for the initial view to render

[`openUrl()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#openurl)
and
[`openData()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#opendata)
resolve after the PDF has opened and the viewer has created its layout. Page
bitmaps are rendered separately and may still be placeholders at that point.
If subsequent work depends on the final canvas pixels—for example, revealing
the viewer, removing an application loading state, or taking a screenshot—set
the initial view first and then wait for its full-quality render.

### Open at an initial page

Navigation methods start the view change but return `void`. Call
[`waitForRender()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#waitforrender)
immediately after them:

```ts
await viewer.openUrl('/documents/manual.pdf');

// Use 0 to jump directly. With a non-zero duration, waitForRender() also waits
// for the navigation animation to finish before it waits for sharp pixels.
viewer.goToPage(12, 0);
await viewer.waitForRender();

// Safe to reveal or capture the viewer here.
```

The same pattern applies to `goToDest()`, `fitToPage()`, `fitToWidth()`,
`fitToHeight()`, and `setZoom()`:

```ts
viewer.goToPage(12, 250);
await viewer.waitForRender(); // animation and final high-resolution paint
```

### Restore an exact saved pan and zoom

When both position and zoom are already known, use
[`setViewTransform(transform)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setviewtransform).
It applies both values together and already includes the same render wait:

```ts
await viewer.openUrl('/documents/manual.pdf');
await viewer.setViewTransform({
  zoom: 2,
  xZoomed: -320,
  yZoomed: -640,
});

// The restored viewport is now painted at full quality.
```

Do not add a second `waitForRender()` after `setViewTransform()`; awaiting
`setViewTransform()` is sufficient.

### What completion means

The promise completes only after every page region actually exposed on screen
has reached the viewer's full-quality target and a canvas frame containing
those bitmaps has been painted. Exposure is the intersection of the viewer with
the browser viewport and any clipping or scrolling ancestors. A viewer element
larger than the screen therefore does not wait for its off-screen regions; a
fully off-screen viewer has no visible render work to wait for. At ordinary
zoom completion means the required whole-page bitmap is available. Above the
whole-page pixel cap it also means that an exact-scale patch covers each exposed
page region.

If the viewport changes while a render wait is pending, the promise follows the
newest viewport. For example, if page 12 is requested and the user moves to page
13 before page 12 finishes, the promise completes after page 13 is fully
painted. Multiple pending waits complete together for that latest view; they do
not report individual navigation cancellation.

[`addTransformChangeListener()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addtransformchangelistener)
serves a different purpose: it observes frame-by-frame pan and zoom changes and
does not indicate that asynchronous page rendering has finished.

## API highlights

Each symbol links directly to its entry in the
[API reference](https://espresso3389.github.io/pdfrx_web/).

- [`openUrl(url, options?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#openurl) / [`openData(data, options?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#opendata) — options include `passwordProvider` for protected documents
- [`goToPage(n)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#gotopage) (current zoom mode is preserved) / [`goToDest(dest)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#gotodest) / [`currentPageNumber`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#currentpagenumber)
- [`setZoomMode(mode)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setzoommode-1) switches the persistent [`ZoomMode`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_viewer.ZoomMode.html) between an explicit factor, page fit, and width fit; read it through [`zoomMode`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoommodezoommode). [`fitToPage(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittopage) / [`fitToWidth(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittowidth) select responsive fit modes, while [`fitToHeight(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittoheight) and [`setZoom(z, viewCenter?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setzoom) select an explicit [`zoom`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoom).
- [`options.layoutDirection`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#layoutdirection) (`'vertical'` / `'horizontal'`) with runtime [`setLayoutDirection(dir)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setlayoutdirection), or a fully custom [`options.layoutPages`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#layoutpages) hook for facing/grid arrangements (build on the exported [`layoutPagesVertical`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_viewer.layoutPagesVertical.html) / [`layoutPagesHorizontal`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_viewer.layoutPagesHorizontal.html))
- Navigation and zoom animate: pass a `duration` (ms) to `goToPage` / `goToDest` / `fitTo*` / `setZoom`, or set a default with [`options.animationDuration`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#animationduration). [`zoomUp()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoomup) / [`zoomDown()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoomdown) snap to zoom stops, and [`zoomToggle(point?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoomtoggle) — plus touch double-tap ([`doubleTapToZoom`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#doubletaptozoom)) — toggle between fit and a zoomed-in level

- [`setViewTransform(transform)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setviewtransform) restores pan and zoom together and resolves after a full-quality paint; [`waitForRender()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#waitforrender) provides that completion barrier after `goToPage()` and the other navigation/zoom APIs. See [Waiting for the initial view to render](#waiting-for-the-initial-view-to-render) for complete load-and-initialize examples and completion semantics.
- [`coverScale`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#coverscale) / [`fitPageScale(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fitpagescale) — the two fit scales; the minimum zoom is their smaller value (or set [`minZoom`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#minzoom)). See [`initialFit`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#initialfit) for the on-load fit mode
- [`createTextSearcher()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#createtextsearcher) — progressive search with match highlighting; recolor the highlights with [`options.matchTextColor`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#matchtextcolor) / [`activeMatchTextColor`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#activematchtextcolor)
- [`selectedText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectedtext) / [`selectAll()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectall) / [`copySelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#copyselection) / [`clearSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#clearselection) — get notified of selection changes with [`addSelectionChangeListener(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addselectionchangelistener) (or pull the current [`selection`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selection)). The change payload carries only the cheap selection **state** (endpoints via [`range`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfTextSelection.html#range)); resolve text and per-page rectangles on demand with [`getSelectedTextRanges()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfTextSelection.html#getselectedtextranges) / [`getSelectedText()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfTextSelection.html#getselectedtext). Set or restore a range programmatically with [`setTextSelection(range)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#settextselection) (round-trips the `range` above) and [`selectWordAtPoint(viewPoint)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectwordatpoint)
- [`addLinkToSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addlinktoselection-1) asks the configured annotation-link handler for one target, then turns each selected visual text line into a Link annotation as one undo step. [`canAddLinkToSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#canaddlinktoselection-1) reports whether both a text selection and link-target UI are available
- [`addTextMarkupToSelection(subtype, color?, opacity?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addtextmarkuptoselection-1) turns the current text selection into per-line PDF markup quads. Pass a [`TextMarkupAnnotationSubtype`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_viewer.TextMarkupAnnotationSubtype.html): `'highlight'`, `'underline'`, `'squiggly'`, or `'strikeout'`. For example, `const ids = await viewer.addTextMarkupToSelection('strikeout', '#d32f2f', 1)` creates an opaque standards-based StrikeOut annotation as one undoable operation and returns its ids in page order; no selection returns `[]`. [`canAddTextMarkupToSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#canaddtextmarkuptoselection-1) gates custom UI; the existing [`highlightSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#highlightselection-1) remains its Highlight shorthand and returns the same id array. For a picker, call [`previewTextMarkupSelection(subtype, color, opacity?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#previewtextmarkupselection-1) on hover or keyboard focus, then [`clearTextMarkupSelectionPreview()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#cleartextmarkupselectionpreview-1) when the candidate is left or the picker closes. Previewing repaints only the selection and does not create an annotation or enter undo history; commit with `addTextMarkupToSelection()`.
- [`options.onLinkTap`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#onlinktap) — intercept link activation (replaces the built-in `window.open` / `goToDest`)
- [`options.autoLinkDetection`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#autolinkdetection) — make URL-like page text clickable when it is not backed by a PDF Link annotation (on by default). Set it to `false` to expose only persisted links; changing it reloads link state without reopening the document
- [`options.contextMenuBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#contextmenubuilder) — replace the built-in right-click / long-press menu (Copy / Highlight / Add link / Select All, in English). Return your own menu element (the viewer positions and dismisses it); this is the hook for localizing or customizing it. `@pdfrx/react` replaces it with a themed, localized menu whose Markup submenu combines subtype and color in one matrix and previews cells on hover/focus
- [`addPageChangeListener(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addpagechangelistener) — notified (deduplicated) when the current page changes; [`viewToDocumentPoint(p)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#viewtodocumentpoint) / [`documentToViewPoint(p)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#documenttoviewpoint) convert between view and document space, and [`getPageHitTestResult(viewPoint)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#getpagehittestresult) maps a screen point to a page and a [PDF-page point](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfPageHitTestResult.html)
- [`setPages(pages)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpages) / [`setPage(pageNumber, page)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpage) — history-aware page insertion, deletion, reorder and rotation. Direct local [`PdfDocument.setPages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) / [`setPage()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage) calls and direct `PdfPage` annotation CRUD are also captured from engine mutation events by an attached viewer
- [`options.interactiveForms`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#interactiveforms) — native HTML controls over AcroForm widgets (on by default), synchronized with the owning source document's [`setFormFieldValue()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalue). A single-source encode preserves the form; mixed-source catalog merging is an application export policy rather than a viewer operation
- FreeText and form controls compose explicit text orientation with page rotation, allowing text to follow the page or remain upright without rewriting annotation coordinates
- [`options.interactiveAnnotations`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#interactiveannotations) — SVG annotation display/editing (on by default). [`setAnnotationMode(true)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setannotationmode) switches from normal viewing/text selection to object interaction; `setAnnotationMode(false)` switches back. Holding `Alt`/`Option` temporarily swaps the effective mode. In annotation mode, primary-click selects an object, primary drag moves it, and primary drag from empty space marquee-selects. Drawing tools temporarily replace the empty-space gesture. Link annotations and other objects whose visible channels are all at or below 5% opacity receive a faint editing-only border so they remain discoverable; the guide is not part of the PDF appearance or export. Configure style with [`setAnnotationStyle()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setannotationstyle), and use [`undo()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#undo) / [`redo()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#redo) for shared edit history
- Text/Note annotations remain readable in normal viewing mode: click the Note icon to open a read-only popup, then click outside it to close. Drag its lower-right corner when the text needs more room; the resize target is intentionally invisible and remains fixed while the body scrolls. The initial popup is clamped to the viewer viewport, and its position and size are viewer-only presentation state; resizing it does not edit the annotation, enter undo history, or change the encoded PDF.
- The SVG overlay follows PDF screen-display flags just like the PDFium page render: annotations marked `Invisible`, `Hidden`, or `NoView` are not painted or hit-tested. This matters for review workflows because a PDF may retain hidden reply/status Text annotations at unrelated page coordinates even though only their visible parent Notes belong on screen. The exception is pdfrx-managed FreeText: it deliberately uses `NoView` to suppress PDFium's default appearance while the deterministic SVG/companion appearance remains visible.
- [`getSelectedAnnotationClientRect()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#getselectedannotationclientrect) returns the viewport bounds of the selected objects and handles for floating UI
- Rectangle and FreeText annotations are one editing concept in the GUI: double-click either to edit text, or type directly while a single object is selected. The viewer pre-focuses an invisible native editor so the first IME composition character is preserved, and re-arms it after an outside-click commit. Non-empty text stores the result as FreeText; clearing it stores a square. Unselected hollow rectangles use their outline for hit testing; selected rectangles accept interaction across their complete bounds. FreeText wrapping and clipping follow resize and movement previews in real time. The inline textarea has no browser resize grip, uses the annotation's current text and fill colors, renders its fill fully opaque (or white when no fill is set), and is focused synchronously so the software keyboard opens on iOS. While it is open, annotation overlay refreshes preserve the active editor and continue rendering updates to other annotations on the page. Customize editor placeholders through [`options.annotationEditorPlaceholders`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#annotationeditorplaceholders)
- [`isLoading`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#isloading) / [`loadingProgress`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#loadingprogress) / [`addLoadingChangeListener(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addloadingchangelistener) — observe document opening; `options.loadingIndicator` controls the built-in spinner/progress bar
- [`loadOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#loadoutline) /
  [`setOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setoutline) /
  [`renderPageThumbnail(n, width)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#renderpagethumbnail)
- [`print({ dpi? })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#print) — rasterized browser printing on desktop; throws on iOS/iPadOS, where WebKit cannot reliably isolate the PDF pages from the viewer UI
- [`options.fontResolver`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#fontresolver) — missing-font fallback (defaults to Google Fonts; pass `null` to disable)
- Viewer and page decoration: [`backgroundColor`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#backgroundcolor) accepts any CSS color, including `rgba(...)` and `transparent` when the embedding application's background should show through. [`pageDropShadow`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagedropshadow) (soft shadow by default; `null` disables) and [`pageBorder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pageborder) (off by default) draw a screen-space shadow/border around each page. For anything custom, [`pagePaintCallbacks`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagepaintcallbacks) and [`pageBackgroundPaintCallbacks`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagebackgroundpaintcallbacks) are `(ctx, pageRect, page)` painters that run in document coordinates on top of / behind each page
- [`pageOverlaysBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pageoverlaysbuilder) / [`setPageOverlaysBuilder(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpageoverlaysbuilder) — place **DOM elements** over each page that pan and zoom with it. Position elements in page-point coordinates; the layer is click-through unless an element sets `pointerEvents: 'auto'`. Call [`refreshOverlays()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshoverlays) to rebuild
- [`viewerOverlayBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#vieweroverlaybuilder) / [`setViewerOverlayBuilder(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setvieweroverlaybuilder) — a **viewport-fixed** DOM layer (does not pan/zoom) for scroll thumbs, floating toolbars, etc.
- Interaction config & callbacks: primary-button background drag pans/selects
  text in normal mode and marquee-selects annotation objects in annotation mode;
  two-finger midpoint movement pans while finger
  separation controls zoom. [`panEnabled`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#panenabled) and [`zoomEnabled`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#zoomenabled) independently enable those two parts; [`scrollByMouseWheel`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#scrollbymousewheel) / [`scrollByArrowKey`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#scrollbyarrowkey) / [`boundaryMargin`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#boundarymargin) / [`panAxis`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#panaxis) (lock single- or two-finger drag-panning to an axis), plus [`onInteractionStart`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#oninteractionstart) / [`onInteractionEnd`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#oninteractionend), [`onViewerReady`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#onviewerready) / [`onViewSizeChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#onviewsizechanged), and [`onGeneralTap`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#ongeneraltap) (tap / double-tap / long-press / secondary-tap)

See the [repository](https://github.com/espresso3389/pdfrx_web) for the demo
app and [architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md).

## Layout, capture, and permissions

### Layout modes

`layoutDirection: 'vertical' | 'horizontal'` remains the continuous single-page
layout. Set `spreadMode` to switch to a built-in book layout:

```ts
const viewer = new PdfrxViewer(host, {
  spreadMode: 'even', // page 1 alone, then [2,3], [4,5], …
});

viewer.setSpreadMode('odd');  // [1,2], [3,4], …
viewer.setSpreadMode('none'); // return to layoutDirection
```

In spread mode, `fitToWidth(pageNumber)` fits the complete row containing that
page—not one half of the spread—and aligns the row to the viewport top.
`fitToPage()` and `fitToHeight()` remain page-scoped.

The DOM-free `@pdfrx/viewer-core` package exports `layoutPagesSpread()` for
applications that want the same geometry without constructing a viewer.
`layoutPages` still takes precedence when a completely custom grid is needed.

### Area capture and marquee zoom

PDF rectangles use points, a bottom-left origin, and y-up coordinates:

```ts
const area = await viewer.selectPageArea(); // Escape returns null
if (area) {
  viewer.zoomToPageArea(area.pageNumber, area.rect, 200);

  const png = await viewer.capturePageArea(area.pageNumber, area.rect, {
    scale: 2,
    type: 'image/png',
    withAnnotations: true,
  });
}
```

`selectPageArea()` is the shared pointer UI; `zoomToPageArea()` and
`capturePageArea()` can also be called directly with application-provided
coordinates. Image encoding uses the browser canvas encoder. PNG is the
portable default; JPEG and WebP availability follows the browser.

### Effective PDF permissions

The viewer respects PDF permission flags by default. Copying, printing, page
assembly, annotation editing, and form editing use the effective permission
getters (`isCopyAllowed`, `isPrintAllowed`, `isDocumentAssemblyAllowed`, and
`isAnnotationEditingAllowed`). Permission flags are advisory interoperability
metadata, not cryptographic enforcement.

Applications can override individual decisions, or deliberately ignore the
document flags:

```ts
const viewer = new PdfrxViewer(host, {
  permissionOverrides: {
    printing: false,
    copying: true,
  },
  // enforceDocumentPermissions: false,
});
```

Direct `PdfDocument` mutation remains an engine-level operation. The permission
policy above governs standard `PdfrxViewer` interactions and UI behavior.

## The pdfrx_web family

| Package | Role |
|---|---|
| [`@pdfrx/colab`](https://www.npmjs.com/package/@pdfrx/colab) | Collaborative React viewer, protocols, client, source adapter, and export composition. |
| [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) | React components and hooks over `@pdfrx/viewer`. |
| **`@pdfrx/viewer`** (this package) | Framework-agnostic `<canvas>` viewer + `<pdfrx-viewer>` element. |
| [`@pdfrx/viewer-core`](https://www.npmjs.com/package/@pdfrx/viewer-core) | DOM-free geometry / layout / selection logic. |
| [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) | Typed client for the WASM rendering worker. |

Building a React app? [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react)
wraps this package with a ready-made toolbar, thumbnails/outline sidebar and
search UI.

## License

MIT
