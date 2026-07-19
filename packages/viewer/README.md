# @pdfrx/viewer

A canvas-based PDF viewer component for the browser. It renders pages, text
selection, links, and search highlights onto a single `<canvas>`, and ships as
a framework-agnostic custom element or a plain class.

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/)**

- Sharp, high-quality rendering with re-rendering on zoom
- Pan / wheel / pinch zoom with inertia, keyboard navigation
- Canvas-painted text selection: mouse drag, double-click word selection,
  touch long-press with draggable handles and a magnifier lens
- Text search with highlights, outline (bookmarks), page thumbnails
- Links (external URLs and internal destinations), context menu, clipboard
- Printing
- Automatic missing-font fallback via Google Fonts
- Password-protected documents

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
  wasm-modules-url="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.1.1/assets/"
  style="width: 100%; height: 100vh"
></pdfrx-viewer>
```

Or programmatically:

```ts
import { PdfrxViewer } from '@pdfrx/viewer';

const viewer = new PdfrxViewer(document.getElementById('container')!, {
  engineOptions: {
    wasmModulesUrl: 'https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.1.1/assets/',
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
- [`goToPage(n)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#gotopage) / [`goToDest(dest)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#gotodest) / [`currentPageNumber`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#currentpagenumber)
- [`fitToPage(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittopage) / [`fitToWidth(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittowidth) / [`fitToHeight(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fittoheight) — fit a page (defaults to the current one); [`setZoom(z, viewCenter?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setzoom) / [`zoom`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#zoom)
- [`coverScale`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#coverscale) / [`fitPageScale(n?)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#fitpagescale) — the two fit scales; the minimum zoom is their smaller value (or set [`minZoom`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#minzoom)). See [`initialFit`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#initialfit) for the on-load fit mode
- [`createTextSearcher()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#createtextsearcher) — progressive search with match highlighting
- [`selectedText`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectedtext) / [`selectAll()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#selectall) / [`copySelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#copyselection) / [`clearSelection()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#clearselection)
- [`loadOutline()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#loadoutline) / [`renderPageThumbnail(n, width)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#renderpagethumbnail)
- [`print({ dpi? })`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#print)
- [`options.fontResolver`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#fontresolver) — missing-font fallback (defaults to Google Fonts; pass `null` to disable)
- Page decoration: [`pageDropShadow`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagedropshadow) (soft shadow by default; `null` disables) and [`pageBorder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pageborder) (off by default) draw a screen-space shadow/border around each page. For anything custom, [`pagePaintCallbacks`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagepaintcallbacks) and [`pageBackgroundPaintCallbacks`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pagebackgroundpaintcallbacks) are `(ctx, pageRect, page)` painters that run in document coordinates on top of / behind each page
- [`pageOverlaysBuilder`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html#pageoverlaysbuilder) / [`setPageOverlaysBuilder(fn)`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#setpageoverlaysbuilder) — place **DOM elements** over each page that pan and zoom with it. Position elements in page-point coordinates; the layer is click-through unless an element sets `pointerEvents: 'auto'`. Call [`refreshOverlays()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshoverlays) to rebuild

See the [repository](https://github.com/espresso3389/pdfrx_web) for the demo
app and [architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md).

## License

MIT
