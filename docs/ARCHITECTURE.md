# Architecture

pdfrx_web is a canvas-based PDF viewer for the browser, split into three
layered packages over a WASM rendering engine that runs in a Web Worker.

<sub>Derived from the [pdfrx](https://github.com/espresso3389/pdfrx) project.</sub>

## Layering

| Layer | Package / files | Responsibility |
|---|---|---|
| Engine core | `packages/engine/assets/pdfium_worker.js` + `pdfium.wasm` (vendored) | The WASM rendering engine, run in a Web Worker. |
| Engine client | `@pdfrx/engine` (`protocol.ts`, `communicator.ts`, `document.ts`) | Typed `postMessage` client: open/render/text/links/outline/fonts. |
| Core logic | `@pdfrx/viewer-core` | DOM-free geometry, layout, viewport math, text flow, selection. |
| Viewer shell | `@pdfrx/viewer` | The `<canvas>` shell: rendering, gestures, selection, search, printing. |

### The worker protocol

`packages/engine/src/protocol.ts` documents every command's parameter and
result shapes (document open/close, progressive loading, page rendering with
partial regions, text with per-character rects, links, outline, font management,
`assemble`/`encodePdf`, and the AcroForm commands — see *Form filling* below).
`assemble` is surfaced on
`PdfDocument` as `assemblePages()`, which writes back the arrangement built with
`setPages` / `setPage` — the only page-editing API — and `encodePdf()` reflects
those edits. Notable client behaviors:

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

## Known limitations

- Form calculations cover only Acrobat's `AFSimple_Calculate` (SUM/PRD/AVG/MIN/MAX);
  arbitrary field JavaScript and `/AA/F` format actions do not run (no JS engine
  in the WASM build). The HTML-overlay controls approximate rather than
  pixel-match the PDF's field styling (font, border). Comb fields, rich text and
  editable combo boxes are not yet handled.
- Scroll physics beyond exponential-decay fling (no platform-specific curves),
  annotation editing.

For the full list of features that upstream [pdfrx](https://github.com/espresso3389/pdfrx)
has but this port does not yet — and which are deliberately out of scope — see
[FEATURE-PARITY.md](FEATURE-PARITY.md).
