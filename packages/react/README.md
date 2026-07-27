# @pdfrx/react

React components and hooks for the pdfrx_web canvas viewer. Start with the
all-in-one [`PdfrxViewerApp`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxViewerApp.html),
compose the supplied UI pieces, or build custom UI with headless hooks.

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo-react/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_react.html)** ·
**[Detailed guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/REACT-GUIDE.md)**

## Highlights

- The all-in-one viewer includes toolbar, responsive thumbnails/outline
  sidebar, search, forms, annotations, page editing, print, and download.
- The same functionality is available as composable components and headless
  hooks, so applications can own as much of the UI as they need.
- Annotation, form, and page changes share one chronological Undo/Redo history.
- PDF and image opening, thumbnail insertion/reordering, and image annotation
  drops are supported by the standard UI.
- Two-page book layouts, rectangular image capture, marquee zoom, and browser
  fullscreen are available as composed controls; the all-in-one app keeps the
  specialized layout/capture tools and printing hidden until explicitly enabled.
- Declarative feature groups and effective PDF permissions consistently hide
  or disable standard print, page-editing, annotation, and form entry points.
- English, Japanese, Simplified and Traditional Chinese, French, and German are
  built in, with string overrides for additional locales.
- CSS custom properties provide theming and responsive behavior; server
  rendering and React StrictMode are supported.
- Application overrides can retain the standard chrome while replacing open,
  page mutation, and export operations.

## Install

```sh
npm install @pdfrx/react react react-dom
```

## Minimal usage

```tsx
import { PdfrxViewerApp } from '@pdfrx/react';
import '@pdfrx/react/styles.css';

export function App() {
  return (
    <PdfrxViewerApp
      src="/manual.pdf"
      wasmModulesUrl="/pdfium/"
      style={{ height: '100dvh' }}
    />
  );
}
```

Copy `pdfium_worker.js` and `pdfium.wasm` from
`node_modules/@pdfrx/engine/assets/` into the public `/pdfium/` directory.
Remote PDF URLs must allow browser CORS access.

Browser printing is supported on desktop platforms. On iOS/iPadOS the standard
print button is omitted because WebKit cannot reliably isolate PDF pages from
the surrounding viewer UI; use the save/download action instead.

## Choose an integration level

- [`PdfrxViewerApp`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxViewerApp.html):
  ready-made toolbar, sidebar, search, forms, annotations, print, and save UI.
- [`PdfrxProvider`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxProvider.html)
  with [`PdfViewerSurface`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfViewerSurface.html):
  compose the supplied components into your own layout.
- Hooks such as
  [`usePdfNavigation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfNavigation.html),
  [`usePdfZoom`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfZoom.html),
  and [`usePdfSearch`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.usePdfSearch.html):
  own the UI while reusing viewer state.

## Next steps

- The [React guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/REACT-GUIDE.md)
  covers composition, hooks, editing, save/history behavior, localization,
  context menus, theming, and runtime notes.
- [Customizing `PdfrxViewerApp`](https://github.com/espresso3389/pdfrx_web/blob/master/docs/REACT-VIEWER-APP-CUSTOMIZATION.md)
  explains application-controlled open, page, and export operations.
- Use [`@pdfrx/colab`](https://www.npmjs.com/package/@pdfrx/colab) for
  synchronized multi-user editing.

## License

MIT
