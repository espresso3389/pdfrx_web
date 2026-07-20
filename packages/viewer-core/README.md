# @pdfrx/viewer-core

Platform-independent core logic of a PDF viewer, in pure TypeScript. No DOM
access — every type is a plain JSON-serializable object. This is the logic
layer underneath [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer);
use it directly to build a custom viewer shell (different rendering stack,
custom gestures).

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_viewer-core.html)**

## Installation

```sh
npm install @pdfrx/viewer-core
```

## What's inside

| Module | Contents |
|---|---|
| `geometry` | Rect/point math, page rotation, PDF page space (y-up) ↔ document space (y-down) conversions |
| `transform` | `ViewTransform {zoom, xZoomed, yZoomed}`, visible-rect/fit calculations, 14 page anchors, boundary clamping, underflow alignment |
| `layout` | Vertical/horizontal page layout and hit testing |
| `text` / `text-formatter` | Structured page text: reading-order analysis, line splitting, word/space/newline fragments, text direction (LTR/RTL/vertical), search |
| `selection` | Nearest-character hit testing, A/B selection anchors (same-page and cross-page), word selection, per-page range expansion for highlighting |

## Example

```ts
import {
  formatText,
  findTextAndIndexForPoint,
  getSelectedRanges,
  composeSelectedText,
  layoutPagesVertical,
} from '@pdfrx/viewer-core';

// Build structured text from an engine's raw page text
const pageText = formatText({ fullText, charRects }, /* pageNumber */ 1);

// Lay out pages and hit-test a pointer position against the text
const layout = layoutPagesVertical(pages, { margin: 8 });
const hit = findTextAndIndexForPoint(docPoint, selectablePages);

// Expand a selection into per-page ranges and compose the clipboard text
const ranges = getSelectedRanges(selA, selB, getLoadedText);
const clipboard = composeSelectedText(ranges);
```

Coordinate conventions: PDF page space is points (1/72"), origin
bottom-left, y-up; document space is y-down. See the
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)
for details.

## The pdfrx_web family

| Package | Role |
|---|---|
| [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) | React components and hooks over `@pdfrx/viewer`. |
| [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) | Framework-agnostic `<canvas>` viewer + `<pdfrx-viewer>` element. |
| **`@pdfrx/viewer-core`** (this package) | DOM-free geometry / layout / selection logic. |
| [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) | Typed client for the WASM rendering worker. |

Full [API reference](https://espresso3389.github.io/pdfrx_web/) ·
[repository](https://github.com/espresso3389/pdfrx_web) ·
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)

## License

MIT
