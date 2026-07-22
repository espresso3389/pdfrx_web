# Architecture

pdfrx_web is a canvas-based PDF viewer for the browser, split into four
layered packages over a WASM rendering engine that runs in a Web Worker.

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

## Layering

| Layer | Package / files | Responsibility |
|---|---|---|
| Engine core | `packages/engine/assets/pdfium_worker.js` + `pdfium.wasm` (vendored) | The WASM rendering engine, run in a Web Worker. |
| Engine client | `@pdfrx/engine` (`protocol.ts`, `communicator.ts`, `document.ts`) | Typed `postMessage` client: open/render/text/links/outline, fonts, forms, annotations, and page editing. |
| Core logic | `@pdfrx/viewer-core` | DOM-free geometry, layout, viewport math, text flow, selection. |
| Viewer shell | `@pdfrx/viewer` | The `<canvas>` shell plus HTML/SVG overlays: rendering, gestures, selection, search, forms, annotations, and printing. |
| React bindings | `@pdfrx/react` | All-in-one and composable viewer UI, localized controls, and headless hooks. |

### The worker protocol

`packages/engine/src/protocol.ts` documents every command's parameter and
result shapes (document open/close, progressive loading, page rendering with
partial regions, text with per-character rects, links, outline, font management,
`assemble`/`encodePdf`, and the AcroForm commands — see *Form filling* below).
`assemble` is surfaced on
`PdfDocument` as `assemblePages()`, which writes back the arrangement built with
`setPages` / `setPage` — the only page-editing API — and `encodePdf()` reflects
those edits. `encodePdfCopy()` normally clones the root document, but when its
virtual arrangement contains pages from exactly one imported document it clones
that source instead; PDFium page import does not copy document-level AcroForm,
outline, metadata, or name-tree dictionaries. Notable client behaviors:

- The worker runs on a `blob:` URL (a bootstrap blob injects the wasm URL), so
  the engine resolves relative document URLs against `document.baseURI` before
  sending them.
- Password retry loop: empty-password first attempt, then the
  `passwordProvider` until success or `null`.
- The engine renders BGRA8888, but the vendored worker swaps channels while
  copying the bitmap out (folded into the copy, so effectively free), so
  `renderPage` returns tightly-packed **RGBA8888** and `PdfImage.toImageData()`
  wraps it zero-copy. RGBA is the only pixel format the web consumes directly.
- Missing-font queries discovered while opening a document are replayed to
  listeners that subscribe later, so late subscribers do not miss them.

## Coordinate conventions

- **PDF page space** (`PdfRect`/`PdfPoint`): points (1/72"), origin at the
  bottom-left, y-up; `top >= bottom`.
- **Document space** (`Rect`/`Offset`): y-down, unzoomed coordinates of the
  whole laid-out document (all pages plus margins).
- **View space**: document space transformed by
  `ViewTransform {zoom, xZoomed, yZoomed}` — a uniform scale + translation.

`PdfPage.loadText()` / `loadLinks()` already compensate for the page
bounding-box offset (`bbLeft` / `bbBottom`).

## viewer-core: pure logic

`@pdfrx/viewer-core` contains no DOM access; all types are plain
JSON-serializable objects.

- `geometry.ts` — rect/point math, rotation, PDF↔document conversions.
- `transform.ts` — viewport math, fit calculations, 14 page anchors, boundary
  clamping and underflow alignment.
- `layout.ts` — vertical/horizontal page layout and hit testing.
- `text.ts` / `text-formatter.ts` — the structured text model and flow analysis
  (reading order, line splitting, word/space/newline fragments, vertical-text
  virtual-newline removal).
- `selection.ts` — the text selection core: nearest-character hit testing, A/B
  anchors (same-page and cross-page), word selection, per-page range expansion.

## viewer: canvas shell

Text selection is painted on the canvas — deliberately **no DOM text layer**;
the canvas approach enables selection behavior DOM ranges cannot express. The
shell adds:

- a pointer state machine (`pan / select / dragHandle / pinch`): mouse text-drag
  selects, background drag pans, touch pans with long-press word selection and
  draggable A/B handles;
- the selection magnifier lens (positioning logic with edge flipping);
- a page bitmap cache with capped base renders plus high-zoom sharp patches
  rendered for the visible region;
- edge auto-scroll during selection drags, fling inertia, links overlay, context
  menu, keyboard navigation, text search, printing via a hidden iframe;
- missing-font fallback: `missingFonts` events resolve through the Google Fonts
  resolver, then the document is reopened with the view state preserved — the
  engine caches substituted fonts per document, so a mapper refresh alone is not
  enough. The worker persists registered fonts in IndexedDB (`pdfrx.fonts`), so
  later sessions resolve instantly. `packages/viewer/src/font-tables.ts` holds
  the Google Fonts weight tables used by the resolver. See
  [FONT-FALLBACK.md](FONT-FALLBACK.md) for the full font-mapping reference.

## Form filling (AcroForm)

The worker inits a PDFium form-fill environment (`FPDFDOC_InitFormFillEnvironment`)
at open and draws widgets via `FPDF_FFLDraw` in `renderPage`. On top of that:

- The worker populates the `FPDF_FORMFILLINFO` callbacks (version 1) — done in
  `_initFormFillInfo`, registered as fixed wasm function pointers via
  `Pdfium.addFunction`. `FFI_Invalidate` and `FFI_OnChange` are relayed to the
  main thread through the existing `type: 'callback'` channel (registered by the
  `registerFormNotify` command). Without these, routing input through `FORM_On*`
  would call null pointers and trap. Per-document state (open interactive pages,
  the notify callback id) is keyed by the `formInfo` pointer, which PDFium hands
  back as `pThis`.
- Reads use `loadFormFields` (enumerate Widget annotations →
  `FPDFAnnot_GetFormField*`). Writes and interactive edits go through the
  form-fill module (`FORM_ReplaceSelection`, `FORM_SetIndexSelected`, or a
  simulated `FORM_OnLButton*` click) so appearances regenerate — raw
  `FPDFAnnot_SetStringValue` would leave a stale appearance stream. Interactive
  input commands (`formOpenPage`/`formClosePage`/`formPointerEvent`/
  `formKeyEvent`/`formKillFocus`) bracket an open page with
  `FORM_OnAfterLoadPage`/`FORM_OnBeforeClosePage`.

The engine surfaces this as `PdfPage.loadFormFields()`,
`PdfDocument.loadFormFields()` / `getFormFieldValue()` / `setFormFieldValue()`,
and a `formFieldsChanged` event; `@pdfrx/react` exposes the `useFormFields`
hook. All new worker blocks are marked with a `[pdfrx_web: form support]`
comment so the vendored-worker sync re-applies them (see the RGBA patch marker).

**Interactive editing uses an HTML overlay, not the canvas.** `@pdfrx/viewer`
lays native controls (`<input>` / `<textarea>` / checkbox / radio / `<select>`)
over each editable widget in a dedicated `formOverlayRoot` layer, positioned in
the page's point-space and transformed to follow pan/zoom exactly like the
`pageOverlaysBuilder` overlays (`updateFormOverlays` mirrors `updateOverlays`).
The controls are the interactive representation; the canvas keeps rendering the
page underneath (the opaque controls hide the duplicate). Editing never
re-renders the canvas — that avoids the flicker of a per-keystroke re-render and
gives native focus, IME, mobile keyboards, dropdowns and accessibility for free.
Edits are written back with `setFormFieldValue` (on `blur` for text, immediately
for checkbox/radio/select); `formFieldsChanged` reconciles control values in
place (skipping the focused element). Gated by the `interactiveForms` option
(default on). The engine still exposes lower-level `FORM_On*` input commands
(`formOpenPage` / `formPointerEvent` / `formKeyEvent` / …) for headless use, but
the viewer no longer drives them.

**Calculated fields.** Auto-calculating forms drive their totals with field
JavaScript (`/AA/C` calculate actions), which this PDFium build cannot run (no
V8). The engine ships a tiny JS-free stand-in ([form-calc.ts](../packages/engine/src/form-calc.ts)):
the worker's `loadFormCalculations` reads each field's calculate-action source,
`parseCalcAction` recognizes Acrobat's built-in `AFSimple_Calculate`
(SUM/PRD/AVG/MIN/MAX), and `setFormFieldValue` recomputes the dependent fields to
a fixed point (so multi-level chains like checkbox → unit-price → subtotal →
grand-total resolve) and writes the changed ones back before firing
`formFieldsChanged`. Read-only computed fields still render as (disabled) overlay
controls so their values stay visible. Toggle with `PdfDocument.formCalculationEnabled`.
Arbitrary custom field scripts and `/AA/F` format actions are **not** run — that
would require shipping a JS engine.

## Annotations

Content annotations (ink, shapes, text markup, notes, free text — everything but
widgets/links/popups) are read, created, edited and exported, mirroring the form
design. New worker functions sit in a `// [pdfrx_web: annotation support]` block
next to the form block:

- **Reads** (`loadAnnotations`) reuse the existing enumeration primitives
  (`FPDFPage_GetAnnot*`, `FPDFAnnot_GetSubtype/GetRect/GetStringValue`) and add
  subtype geometry: ink strokes (`FPDFAnnot_GetInkListPath`), markup quadpoints
  (`FPDFAnnot_GetAttachmentPoints`), line/vertices. Widgets, links and popups are
  skipped (surfaced through the form/link paths).
- **Writes** (`addAnnotation` / `updateAnnotation` / `removeAnnotation`) go
  through `FPDFPage_CreateAnnot` + `FPDFAnnot_Set*` / `AddInkStroke` /
  `AppendAttachmentPoints` / `RemoveAnnot`. The public API only sets the
  geometries PDFium can author: **ink** (also how the viewer realizes line/arrow
  — there is no `/L` or `/Vertices` setter), **markup** quads, and rect-defined
  **square/circle/freeText/text**. An edit is a remove + recreate keeping the same
  id (geometry has no in-place setter), so the client sends the full new spec.
- **Identity.** On creation the worker stamps a generated `/NM` id, returned as
  `PdfAnnotationObject.id`; reads fall back to `@<index>` for annotations without
  one. This survives the index shifts that removals cause.
- **Appearance / export.** After each edit the worker forces PDFium to generate
  and persist `/AP` streams by drawing the page once into a 1×1 `FPDF_ANNOT`
  bitmap. Because `encodePdf` runs `FPDF_SaveAsCopy` on the same live document,
  created annotations are in the exported bytes *and* render in third-party
  viewers. Colors are additionally stored in private `pdfrx:C` / `pdfrx:IC` keys,
  because `FPDFAnnot_GetColor` refuses to report a color once an `/AP` exists.

The engine surfaces `PdfPage.loadAnnotations()`,
`PdfDocument.loadAnnotations()` / `loadHighlights()` / `addAnnotation()` / `updateAnnotation()` /
`removeAnnotation()` / `importAnnotations()`, and an `annotationsChanged` event;
`@pdfrx/react` exposes the `useAnnotations` hook and a `PdfAnnotationToolbar`.

External collaboration uses a versioned `PdfAnnotationSnapshot` for full
save/restore and `PdfAnnotationChange[]` for incremental synchronization. IDs
are preserved in `/NM`; the private `pdfrx:ActorId` and `pdfrx:Revision` keys
retain the last editor and monotonic revision without conflating application
identity with the PDF `/T` author display field. Change events include an
`origin` and optional transaction id so remote application does not echo back.

**Painted through an SVG overlay, not the canvas.** Like forms, `@pdfrx/viewer`
lays a per-page `<svg>` over each page in a dedicated `annotationOverlayRoot`
layer, positioned in point-space and transformed to follow pan/zoom exactly like
`updateFormOverlays` (`updateAnnotationOverlays` mirrors it). While the overlay is
on (the `interactiveAnnotations` option, default on) the canvas renders with a new
`'formsOnly'` mode — form widgets via `FPDF_FFLDraw` but **not** `FPDF_ANNOT` — so
annotations come only from the SVG and per-edit updates never re-render the page
(no flicker). A drawing tool (`setAnnotationTool`) makes the SVG capture pointer
drags to create annotations; with no tool, a selected annotation shows draggable
**anchor handles** — the sole selection indicator — sized to a constant 8px
on-screen regardless of zoom. Freehand pen, rectangle, ellipse and other
rect/markup shapes expose the eight bounding-box handles (corners + edge
midpoints) and drag = uniform **scale** of the whole shape; a handle may cross
the opposite edge freely (no ordering is preserved). Pen and ellipse also draw a
dashed bounding rectangle to show that box (a rectangle already is its box).
Straight lines and arrows (authored as 2-point / multi-stroke ink, distinguished
by `inkStrokeKind`) and polygons keep per-endpoint/per-vertex handles (`annotationAnchors` — each anchor's `reshape`
returns the full edited spec). Dragging the body moves the whole annotation and
Delete removes it; empty areas fall through to the canvas for pan/text-select. Edits write back
through the engine and the `annotationsChanged` event rebuilds the affected
page's SVG.

**Text highlight** is not a drawing tool — it is proper text markup. The user
selects text (normal mode) and picks *Highlight* from the right-click context
menu; `PdfrxViewer.highlightSelection(color?)` turns the selection into per-line
quadpoints (`getSelectedRanges` + `enumerateFragmentBoundingRects`, the same
geometry that paints the selection) and adds one `Highlight` markup annotation
per page as a single undo group. `canHighlightSelection()` gates the menu item.

**Select mode & multi-selection.** `setAnnotationSelectMode(true)` (the toolbar's
Select button) enters a mode where dragging empty page area draws a rubber-band
marquee and selects every overlapping annotation; single-click select still works
with or without it. The selection is a `Set<id>`. A single selection shows the
annotation's own handles; a multi-selection shows one group bounding box whose
eight handles scale every member together (`scaleAnnotationSpec` maps each
member's own rect/geometry through the group's affine transform) and whose body
drag moves them all. Anchors follow live during both.

**Undo/redo** is unlimited and lives in the viewer as a stack of command
*groups* — each group is one or more `{pageNumber, id, before, after}` commands
(a full annotation spec, or `null` for "absent") applied/undone atomically, so a
multi-object move/resize/delete is a single step. Because `updateAnnotation`
creates the annotation when its id is not found, replaying any state is uniformly
"remove (null) or create/replace by id", so create/delete/move/reshape all undo
and redo the same way. `undoAnnotation()`/`redoAnnotation()` drive the document
to the neighbouring group state without recording.

Page-arrangement changes use the same synchronization boundary. `setPages()` /
`setPage()` accept an origin plus optional transaction and actor IDs, and
`pagesRearranged` carries before/after arrangement descriptors. A
`'materialize'` origin distinguishes `assemblePages()` replacing proxies with
native pages from a semantic user edit. `PdfrxViewer` additionally accepts
`recordHistory: false` for remote/restore application, while React consumers can
subscribe to the exact events with `usePdfPageChanges()`.

## Known limitations

- Form calculations cover only Acrobat's `AFSimple_Calculate` (SUM/PRD/AVG/MIN/MAX);
  arbitrary field JavaScript and `/AA/F` format actions do not run (no JS engine
  in the WASM build). The HTML-overlay controls approximate rather than
  pixel-match the PDF's field styling (font, border). Comb fields, rich text and
  editable combo boxes are not yet handled.
- Annotations: the SVG overlay renders the geometries pdfrx_web understands
  (ink, markup, square/circle, line/polygon, note/free-text). Subtypes it cannot
  reproduce faithfully — image stamps, and any type drawn only from an `/AP`
  stream — show as a plain rectangle outline while the overlay is on, because the
  canvas no longer draws them. Line/arrow are stored as ink annotations (no
  PDFium geometry setter for `Line`/`Polygon`).
- Scroll physics beyond exponential-decay fling (no platform-specific curves).

For the full list of features that upstream [pdfrx](https://github.com/espresso3389/pdfrx)
has but this port does not yet — and which are deliberately out of scope — see
[FEATURE-PARITY.md](FEATURE-PARITY.md).

## Collaborative applications

Networking and session identity stay above the reusable viewer packages. See
[COLLABORATION.md](COLLABORATION.md) for the implemented page/annotation/form
session model, stable page-placement protocol, client-local application model,
and mixed-source export policy used by the private collaboration workspace.
