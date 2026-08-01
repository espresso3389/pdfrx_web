# @pdfrx/viewer-core

Platform-independent core logic of a PDF viewer, in pure TypeScript. No DOM
access — every type is a plain JSON-serializable object. This is the logic
layer underneath [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer);
use it directly to build a custom viewer shell (different rendering stack,
custom gestures).

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

**[npm package](https://www.npmjs.com/package/@pdfrx/viewer-core)** ·
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

These primitives are DOM-free and JSON-serializable. They support vertical,
horizontal, and custom viewer shells without coupling layout, coordinates, text
analysis, or selection behavior to canvas rendering or a UI framework.

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

## Next steps

See the complete
[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_viewer-core.html)
for exported geometry, layout, text, and selection symbols. The
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)
define coordinate conventions and package boundaries.

- Related packages:
  [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) ·
  [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) ·
  [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react)

## License

MIT
