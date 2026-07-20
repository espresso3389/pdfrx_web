# @pdfrx/react

React bindings for [pdfrx_web](https://github.com/espresso3389/pdfrx_web) — a
canvas-based PDF viewer for the browser.

`@pdfrx/viewer` gives you a viewer *class*; this package gives you a viewer
*component*, plus the thumbnail, outline and search UI that the class
deliberately leaves to the app.

```sh
npm install @pdfrx/react
```

## Three layers

Pick the one that matches how much of the UI you want to own.

### 1. All-in-one

Toolbar, thumbnails/outline sidebar, search, print — the whole thing:

```tsx
import { PdfrxViewerApp } from '@pdfrx/react';
import '@pdfrx/react/styles.css';

<PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="/pdfium/" style={{ height: '100vh' }} enableFileOpen />;
```

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
`PdfPrintButton`, `PdfLoadingBar`.

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
| `usePdfSearch()` | Query, matches, current index, next/previous |
| `usePdfSelection()` | Selected range, resolved text and rects, copy |
| `usePdfPageThumbnail()` | One page rendered to a canvas, through a shared cache |
| `usePdfPrint()` | `print()` plus an `isPrinting` flag |

## Two things your app must provide

1. **The engine's WASM assets.** Point `wasmModulesUrl` at a directory holding
   `pdfium_worker.js` and `pdfium.wasm` — copy them from
   `node_modules/@pdfrx/engine/assets/`, or use the CDN:

   ```tsx
   <PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.2.1/assets/" />
   ```

2. **CORS for remote PDFs**, since the document is fetched like any other
   resource.

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

## License

MIT
