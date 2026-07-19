# pdfrx_web

A canvas-based PDF viewer component for the browser, written in TypeScript.
It is a web-native port of the [pdfrx](https://github.com/espresso3389/pdfrx)
Flutter viewer, built on the same pdfium WASM engine — same rendering
fidelity, same behavior, no Flutter runtime.

**Features**

- pdfium-quality rendering with zoomed sharp re-rendering
- Pan / wheel / pinch zoom with inertia, keyboard navigation
- Canvas-painted text selection: mouse drag, double-click word selection,
  touch long-press with draggable handles and a magnifier lens
- Text search with highlights, outline (bookmarks), page thumbnails
- Links (external URLs and internal destinations), context menu, clipboard
- Printing
- Automatic missing-font fallback via Google Fonts (Arimo/Tinos/Cousine for
  standard fonts, Noto families for CJK and other scripts)
- Password-protected documents

## Try the demo

```sh
git clone https://github.com/espresso3389/pdfrx_web.git
cd pdfrx_web
npm install
npm run build
npm run dev     # open http://localhost:5173
```

The demo has a search bar, thumbnails/outline sidebar, print button, and
supports opening local files (button or drag & drop) and URLs.

## Usage

> [!NOTE]
> The packages are not published to npm yet; consume them from this
> repository (e.g. as a git dependency or workspace) for now.

The easiest way is the `<pdfrx-viewer>` custom element:

```html
<script type="module">
  import { definePdfrxViewerElement } from '@pdfrx/viewer';
  definePdfrxViewerElement();
</script>

<!-- size it with CSS; wasm-modules-url points at the pdfium engine assets -->
<pdfrx-viewer
  src="/documents/manual.pdf"
  wasm-modules-url="/pdfium/"
  style="width: 100%; height: 100vh"
></pdfrx-viewer>
```

Or drive the viewer programmatically:

```ts
import { PdfrxViewer } from '@pdfrx/viewer';

const viewer = new PdfrxViewer(document.getElementById('container')!, {
  engineOptions: { wasmModulesUrl: '/pdfium/' },
});
await viewer.openUrl('/documents/manual.pdf');

viewer.goToPage(3);
const searcher = viewer.createTextSearcher();
searcher.startTextSearch('keyword');
console.log(viewer.selectedText);
await viewer.print();
```

Two things your app must provide:

1. **The pdfium engine assets.** Copy `pdfium_worker.js` and `pdfium.wasm`
   from `@pdfrx/engine/assets/` to a static path on your server and point
   `wasmModulesUrl` at it. They can live on any origin (a CDN is fine).
2. **CORS for remote PDFs.** `openUrl` fetches the document, so PDFs on
   other origins need CORS headers (same as any `fetch`).

Documents opened from a `File`/`ArrayBuffer` use `viewer.openData(data)`.
Password-protected files are supported via
`openUrl(url, { passwordProvider: () => prompt('Password?') })`.

## Packages

| Package | Description |
|---|---|
| [`@pdfrx/viewer`](packages/viewer) | The viewer component (`<pdfrx-viewer>` / `PdfrxViewer`). |
| [`@pdfrx/viewer-core`](packages/viewer-core) | Platform-independent core logic: geometry, layout, viewport math, text flow analysis, selection. No DOM. |
| [`@pdfrx/engine`](packages/engine) | Typed client for the pdfium WASM worker: open/render pages, text, links, outline, fonts. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the packages relate
to the pdfrx Dart/Flutter implementation, the worker protocol contract, and
coordinate conventions.

## Development

```sh
npm install
npm run build     # tsc for all packages
npm test          # viewer-core unit tests (vitest)
npm run dev       # example app (Vite)
```

The pdfium engine assets are vendored under `packages/engine/assets/`, so a
plain clone builds and runs standalone — no submodule, no postinstall.

### Updating vendored code from pdfrx (maintainers)

The pdfrx repository is the single source of truth for the engine assets and
the Google Fonts tables; it is available as the `external/pdfrx` submodule:

```sh
git submodule update --init      # once
node scripts/sync-assets.mjs     # refresh pdfium_worker.js / pdfium.wasm (+ UPSTREAM.md)
node scripts/gen-font-tables.mjs # regenerate packages/viewer/src/font-tables.ts
```

Both scripts also accept an explicit checkout path or the `PDFRX_REPO`
environment variable instead of the submodule.

## License

MIT — see [LICENSE](LICENSE). The Google Fonts files downloaded by the font
fallback are licensed under the SIL OFL 1.1 / Apache 2.0 by their respective
owners.
