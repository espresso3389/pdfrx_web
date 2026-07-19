# @pdfrx/viewer-core

Platform-independent core logic of the
[pdfrx](https://github.com/espresso3389/pdfrx) PDF viewer, ported to pure
TypeScript. No DOM access — every type is a plain JSON-serializable object.
This is the logic layer underneath
[`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer); use it
directly to build a custom viewer shell (different rendering stack, custom
gestures) while keeping pdfrx's behavior.

## Installation

```sh
npm install @pdfrx/viewer-core
```

## What's inside

| Module | Ported from (pdfrx) | Contents |
|---|---|---|
| `geometry` | `pdf_rect.dart`, `pdf_point.dart`, conversion extensions | Rect/point math, page rotation, PDF page space (y-up) ↔ document space (y-down) conversions |
| `transform` | `PdfMatrix4Ext`, `_calcMatrixFor*`, `_calcOverscroll` | `ViewTransform {zoom, xZoomed, yZoomed}`, visible-rect/fit calculations, 14 page anchors, boundary clamping, underflow alignment |
| `layout` | `_layoutPages` | Vertical/horizontal page layout and hit testing |
| `text` / `text-formatter` | `pdf_text.dart`, `pdf_text_formatter.dart` | Structured page text: reading-order analysis, line splitting, word/space/newline fragments, text direction (LTR/RTL/vertical), search |
| `selection` | the selection logic in `pdf_viewer.dart` | Nearest-character hit testing, A/B selection anchors (same-page and cross-page), word selection, per-page range expansion for highlighting |

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

Coordinate conventions match pdfrx: PDF page space is points (1/72"), origin
bottom-left, y-up; document space is y-down. See the
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)
for details.

## License

MIT
