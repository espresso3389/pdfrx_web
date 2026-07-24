# @pdfrx/viewer

A canvas-based PDF viewer component for the browser. It renders pages, text
selection, links, and search highlights onto a single `<canvas>`, and ships as
a framework-agnostic custom element or a plain class.

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_viewer.html)**

- Sharp, high-quality rendering with re-rendering on zoom
- Pan by primary-button background or touch drag, wheel / pinch zoom with
  inertia; primary-button object/anchor drags edit annotations and
  secondary-button drag marquee-selects them
- Canvas-painted text selection: mouse drag, double-click word selection,
  touch long-press with draggable handles and a magnifier lens
- Text search with highlights, outline (bookmarks), page thumbnails
- Links (external URLs and internal destinations), context menu, clipboard
- Printing
- Automatic missing-font fallback via Google Fonts
- Password-protected documents
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
  wasm-modules-url="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.14.0/assets/"
  style="width: 100%; height: 100vh"
></pdfrx-viewer>
```

Or programmatically:

```ts
import { PdfrxViewer } from '@pdfrx/viewer';

const viewer = new PdfrxViewer(document.getElementById('container')!, {
  engineOptions: {
    wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.14.0/assets/',
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

## API highlights

Each symbol links directly to its entry in the
[API reference](https://espresso3389.github.io/pdfrx_web/).

- [`openUrl(url, options?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#openurl) / [`openData(data, options?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#opendata) — options include `passwordProvider` for protected documents
- [`goToPage(n)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#gotopage) (current zoom mode is preserved) / [`goToDest(dest)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#gotodest) / [`currentPageNumber`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#currentpagenumber)
- [`setZoomMode(mode)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setzoommode-1) switches the persistent [`ZoomMode`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_viewer.ZoomMode.html) between an explicit factor, page fit, and width fit; read it through [`zoomMode`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoommodezoommode). [`fitToPage(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittopage) / [`fitToWidth(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittowidth) select responsive fit modes, while [`fitToHeight(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittoheight) and [`setZoom(z, viewCenter?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setzoom) select an explicit [`zoom`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoom).
- [`options.layoutDirection`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#layoutdirection) (`'vertical'` / `'horizontal'`) with runtime [`setLayoutDirection(dir)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setlayoutdirection), or a fully custom [`options.layoutPages`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#layoutpages) hook for facing/grid arrangements (build on the exported [`layoutPagesVertical`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_viewer.layoutPagesVertical.html) / [`layoutPagesHorizontal`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_viewer.layoutPagesHorizontal.html))
- Navigation and zoom animate: pass a `duration` (ms) to `goToPage` / `goToDest` / `fitTo*` / `setZoom`, or set a default with [`options.animationDuration`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#animationduration). [`zoomUp()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoomup) / [`zoomDown()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoomdown) snap to zoom stops, and [`zoomToggle(point?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoomtoggle) — plus touch double-tap ([`doubleTapToZoom`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#doubletaptozoom)) — toggle between fit and a zoomed-in level
- [`coverScale`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#coverscale) / [`fitPageScale(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fitpagescale) — the two fit scales; the minimum zoom is their smaller value (or set [`minZoom`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#minzoom)). See [`initialFit`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#initialfit) for the on-load fit mode
- [`createTextSearcher()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#createtextsearcher) — progressive search with match highlighting; recolor the highlights with [`options.matchTextColor`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#matchtextcolor) / [`activeMatchTextColor`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#activematchtextcolor)
- [`selectedText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectedtext) / [`selectAll()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectall) / [`copySelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#copyselection) / [`clearSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#clearselection) — get notified of selection changes with [`addSelectionChangeListener(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addselectionchangelistener) (or pull the current [`selection`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selection)). The change payload carries only the cheap selection **state** (endpoints via [`range`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfTextSelection.html#range)); resolve text and per-page rectangles on demand with [`getSelectedTextRanges()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfTextSelection.html#getselectedtextranges) / [`getSelectedText()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfTextSelection.html#getselectedtext). Set or restore a range programmatically with [`setTextSelection(range)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#settextselection) (round-trips the `range` above) and [`selectWordAtPoint(viewPoint)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectwordatpoint)
- [`options.onLinkTap`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#onlinktap) — intercept link activation (replaces the built-in `window.open` / `goToDest`)
- [`options.contextMenuBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#contextmenubuilder) — replace the built-in right-click / long-press menu (Copy / Select All, in English). Return your own menu element (the viewer positions and dismisses it); this is the hook for localizing or customizing it. `@pdfrx/react` uses it to render a themed, localized menu
- [`addPageChangeListener(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addpagechangelistener) — notified (deduplicated) when the current page changes; [`viewToDocumentPoint(p)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#viewtodocumentpoint) / [`documentToViewPoint(p)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#documenttoviewpoint) convert between view and document space, and [`getPageHitTestResult(viewPoint)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#getpagehittestresult) maps a screen point to a page and a [PDF-page point](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfPageHitTestResult.html)
- [`setPages(pages)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpages) / [`setPage(pageNumber, page)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpage) — history-aware page insertion, deletion, reorder and rotation. Direct local [`PdfDocument.setPages()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpages) / [`setPage()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setpage) calls and direct `PdfPage` annotation CRUD are also captured from engine mutation events by an attached viewer
- [`options.interactiveForms`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#interactiveforms) — native HTML controls over AcroForm widgets (on by default), synchronized with the owning source document's [`setFormFieldValue()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#setformfieldvalue). A single-source encode preserves the form; mixed-source catalog merging is an application export policy rather than a viewer operation
- FreeText and form controls compose explicit text orientation with page rotation, allowing text to follow the page or remain upright without rewriting annotation coordinates
- [`options.interactiveAnnotations`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#interactiveannotations) — SVG annotation display/editing (on by default); choose a drawing tool with [`setAnnotationTool()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setannotationtool), while object selection remains permanently available. Configure stroke, fill, opacity, thickness, text color, and font size with [`setAnnotationStyle()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setannotationstyle), and use [`undoAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#undoannotation) / [`redoAnnotation()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#redoannotation) for the shared edit history. Primary-click selects one object, while `Ctrl`/`Cmd` adds or toggles selections; a secondary-button marquee updates selection while it is dragged and suppresses the trailing context menu. Pen strokes, straight lines, and arrows use distance-to-segment hit testing (6 screen px for mouse/pen, 10 px for touch, plus half the stroke width), and marquee selection tests their segments instead of their bounding rectangles. Unfilled rectangles and ellipses likewise select only on or near their outlines. Primary-button body and anchor drags snap each movable axis to nearby annotation coordinates and show alignment guides; initial drawing start/end coordinates use the same snapping except for freehand ink. Hold `Shift` while dragging a bounding-box or group anchor to preserve its original aspect ratio. `Ctrl`/`Cmd`+`A` selects all document text unless an annotation is already selected, in which case it selects all annotations on the current page
- Rectangle and FreeText annotations are one editing concept in the GUI: double-click either to edit text. Selecting an empty rectangle shows a localized, clickable **Add text** banner; text-bearing FreeText accepts a double-click across its text/background area. Non-empty text stores the result as FreeText; clearing it stores a square. Filled rectangles retain full-interior hit testing, while unfilled rectangles otherwise use their outline. FreeText wrapping and clipping follow resize and movement previews in real time. Customize the editor placeholders and banner through [`options.annotationEditorPlaceholders`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#annotationeditorplaceholders)
- [`isLoading`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#isloading) / [`loadingProgress`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#loadingprogress) / [`addLoadingChangeListener(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#addloadingchangelistener) — observe document opening; `options.loadingIndicator` controls the built-in spinner/progress bar
- [`loadOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#loadoutline) / [`renderPageThumbnail(n, width)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#renderpagethumbnail)
- [`print({ dpi? })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#print)
- [`options.fontResolver`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#fontresolver) — missing-font fallback (defaults to Google Fonts; pass `null` to disable)
- Page decoration: [`pageDropShadow`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagedropshadow) (soft shadow by default; `null` disables) and [`pageBorder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pageborder) (off by default) draw a screen-space shadow/border around each page. For anything custom, [`pagePaintCallbacks`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagepaintcallbacks) and [`pageBackgroundPaintCallbacks`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagebackgroundpaintcallbacks) are `(ctx, pageRect, page)` painters that run in document coordinates on top of / behind each page
- [`pageOverlaysBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pageoverlaysbuilder) / [`setPageOverlaysBuilder(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpageoverlaysbuilder) — place **DOM elements** over each page that pan and zoom with it. Position elements in page-point coordinates; the layer is click-through unless an element sets `pointerEvents: 'auto'`. Call [`refreshOverlays()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshoverlays) to rebuild
- [`viewerOverlayBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#vieweroverlaybuilder) / [`setViewerOverlayBuilder(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setvieweroverlaybuilder) — a **viewport-fixed** DOM layer (does not pan/zoom) for scroll thumbs, floating toolbars, etc.
- Interaction config & callbacks: primary-button background drag pans the
  document, primary-button object/anchor drag edits annotations, and
  secondary-button drag marquee-selects annotation objects;
  two-finger midpoint movement pans while finger
  separation controls zoom. [`panEnabled`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#panenabled) and [`zoomEnabled`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#zoomenabled) independently enable those two parts; [`scrollByMouseWheel`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#scrollbymousewheel) / [`scrollByArrowKey`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#scrollbyarrowkey) / [`boundaryMargin`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#boundarymargin) / [`panAxis`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#panaxis) (lock single- or two-finger drag-panning to an axis), plus [`onInteractionStart`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#oninteractionstart) / [`onInteractionEnd`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#oninteractionend), [`onViewerReady`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#onviewerready) / [`onViewSizeChanged`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#onviewsizechanged), and [`onGeneralTap`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#ongeneraltap) (tap / double-tap / long-press / secondary-tap)

See the [repository](https://github.com/espresso3389/pdfrx_web) for the demo
app and [architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md).

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
