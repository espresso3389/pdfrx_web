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
   <PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.5.0/assets/" />
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

The right-click / long-press menu (Copy / Select All) is themed and localized
out of the box. Pass `contextMenuBuilder` to customize it — it receives the
event context plus `{ viewer, strings }`, so you can reuse the built-in
`buildDefaultContextMenu` and append your own items:

```tsx
import { PdfrxViewerApp, buildDefaultContextMenu } from '@pdfrx/react';

<PdfrxViewerApp
  src="/manual.pdf"
  contextMenuBuilder={(context, { viewer, strings }) => {
    // Start from the default localized Copy / Select All menu…
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
| **`@pdfrx/react`** (this package) | React components and hooks over `@pdfrx/viewer`. |
| [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) | Framework-agnostic `<canvas>` viewer + `<pdfrx-viewer>` element. |
| [`@pdfrx/viewer-core`](https://www.npmjs.com/package/@pdfrx/viewer-core) | DOM-free geometry / layout / selection logic. |
| [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) | Typed client for the WASM rendering worker. |

Full [API reference](https://espresso3389.github.io/pdfrx_web/) ·
[repository](https://github.com/espresso3389/pdfrx_web) ·
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)

## License

MIT
