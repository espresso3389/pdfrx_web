# @pdfrx/viewer

A framework-agnostic, canvas-based PDF viewer for the browser. It provides the
[`PdfrxViewer`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html)
class and the `<pdfrx-viewer>` custom element, with navigation, zoom, text
selection, links, search, forms, annotations, and page editing.

**[Live demo](https://espresso3389.github.io/pdfrx_web/demo/)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_viewer.html)** ·
**[Detailed guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/VIEWER-GUIDE.md)**

## Highlights

- A single canvas renders sharp pages and re-renders them as zoom changes.
- Mouse and touch text selection include word selection, long-press handles,
  and a magnifier; search matches and PDF links are interactive.
- Annotation editing supports ink, shapes, markup, notes, FreeText, image
  stamps, snapping, multi-selection, and shared Undo/Redo.
- Interactive AcroForm controls stay synchronized with the underlying PDF.
- Page insertion, deletion, reordering, duplication, and rotation remain
  history-aware and can be encoded back to PDF.
- Vertical, horizontal, odd/even two-page spreads, and custom page layouts
  share navigation, animated fit modes, zoom, and coordinate conversion APIs.
- Rectangular capture renders a page sub-region to PNG/JPEG/WebP, and the same
  selection UI supports marquee zoom.
- Standard interactions resolve PDF copying, printing, assembly, annotation,
  and form permissions with optional application overrides.
- Page-following and viewport-fixed DOM overlays support custom application UI
  without replacing canvas rendering.

## Install

```sh
npm install @pdfrx/viewer
```

## Minimal usage

```ts
import { PdfrxViewer } from '@pdfrx/viewer';

const viewer = new PdfrxViewer(document.querySelector('#viewer')!, {
  engineOptions: { wasmModulesUrl: '/pdfium/' },
});

await viewer.openUrl('/manual.pdf');
```

```css
#viewer {
  width: 100%;
  height: 100vh;
}
```

Serve `pdfium_worker.js` and `pdfium.wasm` from
`node_modules/@pdfrx/engine/assets/` at the configured `wasmModulesUrl`. Remote
PDF URLs must allow browser CORS access.

## Next steps

- The [viewer guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/VIEWER-GUIDE.md)
  covers the custom element, layout, interaction, editing, overlays, events,
  and other viewer options.
- See [`PdfrxViewerOptions`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html)
  and the complete [API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_viewer.html).
- Building React UI? Use
  [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react).

## License

MIT
