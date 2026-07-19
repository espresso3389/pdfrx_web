# @pdfrx/viewer

A canvas-based PDF viewer component for the browser — a web-native TypeScript
port of the [pdfrx](https://github.com/espresso3389/pdfrx) Flutter viewer,
built on the same pdfium WASM engine. Same rendering fidelity, same behavior,
no Flutter runtime.

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/)**

- pdfium-quality rendering with zoomed sharp re-rendering
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

`wasmModulesUrl` must point at a directory containing `pdfium_worker.js` and
`pdfium.wasm`. Use the jsDelivr URL above, or self-host by copying them from
`node_modules/@pdfrx/engine/assets/`. Remote PDFs are fetched with `fetch`,
so cross-origin documents need CORS headers.

## API highlights

- `openUrl(url, options?)` / `openData(data, options?)` — options include
  `passwordProvider` for protected documents
- `goToPage(n)` / `goToDest(dest)` / `currentPageNumber`
- `createTextSearcher()` — progressive search with match highlighting
- `selectedText` / `selectAll()` / `copySelection()` / `clearSelection()`
- `loadOutline()` / `renderPageThumbnail(n, width)`
- `print({ dpi? })`
- `options.fontResolver` — missing-font fallback (defaults to Google Fonts;
  pass `null` to disable)

See the [repository](https://github.com/espresso3389/pdfrx_web) for the demo
app and [architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md).

## License

MIT
