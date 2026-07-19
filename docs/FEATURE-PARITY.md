# Feature parity with pdfrx

pdfrx_web is derived from the Flutter/Dart [pdfrx](https://github.com/espresso3389/pdfrx)
project. This document tracks features that exist **upstream in pdfrx but are
not (yet) in pdfrx_web**, so contributors can see what is left to port and what
was deliberately left out.

It is a moving target — update it as features land. It is **not** a list of
things pdfrx_web has that pdfrx lacks.

**Legend**

- ❌ Not implemented — a candidate to port.
- ◐ Partial — a narrower version exists; details in Notes.
- ⏸️ Intentionally not ported — Flutter-specific, web-inapplicable, or a
  deliberate design difference.

Upstream API names are given so you can find the reference implementation.

> Absent in **both** projects (so *not* pdfrx_web gaps): form-field
> enumeration/filling, document metadata/info dictionary, page labels, embedded
> file attachments, embedded JavaScript, digital signatures, annotation
> creation/editing, and page-content editing / watermarking / flattening.
> Annotation data is read-only and surfaced only through `PdfLink.annotation`.

---

## Engine (`@pdfrx/engine`)

| Feature | Status | Notes |
|---|---|---|
| Page manipulation: reorder / rotate / duplicate / import pages, `encodePdf` reflecting edits | ❌ | Upstream `PdfDocument.pages=` setter + `assemble()` + page proxies (`rotatedBy`, `withPageNumber`, cross-document import). The `assemble` **worker command already exists** in `protocol.ts` but is not exposed on `PdfDocument`; `encodePdf()` currently encodes the document as-is. This is the single biggest engine gap. |
| Custom random-access source | ❌ | Upstream `PdfDocument.openCustom({read, fileSize, …})` — supply bytes on demand via a read callback. pdfrx_web opens only via `openUrl` / `openData`. |
| Render cancellation | ❌ | Upstream `page.render(cancellationToken:)` + `PdfPageRenderCancellationToken`. pdfrx_web renders are fire-and-forget (the viewer's cache mitigates this internally, but there is no public cancel). |
| Permission helpers | ◐ | pdfrx_web `PdfPermissions` exposes `{permissions, securityHandlerRevision}` only. Upstream adds `allowsCopying`, `allowsPrinting`, `allowsDocumentAssembly`, `allowsModifyAnnotations`. Easy to add from the raw flags. |
| Rich page-status events | ◐ | Upstream `pageStatusChanged` reports per-page `moved(oldPageNumber)` / `modified`. pdfrx_web emits `{pageNumbers}` only. |
| Font management model | ◐ | Different design. Upstream ships `PdfFontManager` with pluggable resolvers, OS font discovery (`.windows/.linux/.macos`), `loadMissingFonts`, charset metadata, and local font files. pdfrx_web covers the same *need* with `addFontData` / `reloadFonts` / `clearAllFontData` + the built-in `googleFontsResolver`. Full manager API is not ported. |
| Request timeout for URL open | ◐ | Upstream `openUri(timeout:)`. pdfrx_web `openUrl` supports `headers` / `withCredentials` / `preferRangeAccess` but no timeout. |
| Low-level PDFium binding access | ⏸️ | Upstream `useNativeDocumentHandle`, `PdfrxEntryFunctions`, raw FFI. Not applicable across the worker boundary. |
| Alternate backends (PDFKit / CoreGraphics) | ⏸️ | pdfrx_web is PDFium-WASM only. |

---

## Viewer — navigation, zoom & coordinates

| Feature | Status | Notes |
|---|---|---|
| Animated navigation / zoom transitions | ❌ | Upstream `goToPage/goToArea/goToDest/setZoom(duration:)` animate. pdfrx_web moves are instant. |
| Double-tap / dbl-click to zoom | ❌ | Upstream double-tap cycles zoom stops. pdfrx_web double-click selects a word instead; no zoom-toggle gesture. |
| Zoom snap steps | ❌ | Upstream `zoomUp/zoomDown`, `getNextZoom/getPreviousZoom`, and `PdfViewerZoomStepsDelegate` (Default/Smart) provide discrete stops. pdfrx_web zoom is continuous (`setZoom`, ctrl+wheel, pinch). |
| `goToArea` / `goToRectInsidePage` / `goToPosition` | ◐ | pdfrx_web has `goToPage`, `goToDest`, `fitToPage/Width/Height`, `ensureVisiblePageRect`. The richer target-a-rect/position/anchor family (with `PdfPageAnchor`) is not surfaced publicly, though the math lives in `@pdfrx/viewer-core`. |
| Public coordinate conversion & hit-testing | ❌ | Upstream `globalToLocal/localToDocument/…`, `getPdfPageHitTestResult`, `PdfViewerCoordinateConverter`. pdfrx_web keeps `viewToDocument`/`documentToView` in core but exposes no public "screen point → page + PDF point" API on the viewer. |
| `onPageChanged` notification | ◐ | pdfrx_web exposes the `currentPageNumber` getter and `addDocumentChangeListener`, but no event that fires when the current page changes (the example polls on a timer). |
| `onViewerReady` / `onViewSizeChanged` callbacks | ❌ | No direct equivalents. |

---

## Viewer — layout

| Feature | Status | Notes |
|---|---|---|
| Horizontal scroll / layout | ◐ | `layoutPagesHorizontal` exists in `@pdfrx/viewer-core`, but `PdfrxViewer` hardcodes `layoutPagesVertical`. There is no option to switch scroll direction. |
| Facing / two-up / grid layouts | ❌ | Upstream custom `layoutPages` function supports facing pages, spreads, etc. pdfrx_web has no custom-layout injection point. |
| Custom `layoutPages` hook | ❌ | Upstream lets the app compute `PdfPageLayout` (page rects + document size). Not exposed. |
| Page-snapping / anchored underflow alignment options | ◐ | Boundary/overscroll clamping and anchors exist in core; the viewer does not expose `pageAnchor` / snap configuration. |

---

## Viewer — interaction & configurability

pdfrx_web already implements the core gestures: **pan, pinch-zoom, wheel
(and ctrl+wheel zoom), inertia/fling, keyboard navigation, long-press & dbl-click
word selection, context menu, selection magnifier, links overlay, touch
handles, auto-scroll during selection drag, and page overlays.** The gaps are
mostly *configuration knobs and callbacks* that `PdfViewerParams` exposes:

| Feature | Status | Notes |
|---|---|---|
| Interaction toggles / limits | ❌ | Upstream `panEnabled`, `scaleEnabled`, `panAxis`, `boundaryMargin`, `scrollByMouseWheel`, `scrollByArrowKey`, keyboard-nav enable/params. pdfrx_web hardcodes these. |
| Interaction callbacks | ❌ | Upstream `onInteractionStart/Update/End`, `onGeneralTap` (tap/dblTap/longPress/secondaryTap), `onSecondaryTapUp`, `onLongPressStart`, `onKey`. pdfrx_web has none. |
| Viewer-fixed overlays (`viewerOverlayBuilder`) | ❌ | pdfrx_web has **page** overlays (pan/zoom with the page) but no viewport-fixed overlay layer. |
| Scroll thumbs | ❌ | Upstream `PdfViewerScrollThumb`. Not ported (depends on `viewerOverlayBuilder`). |
| Loading / progress / error UI hooks | ◐ | Upstream `loadingBannerBuilder` (with download progress), `errorBannerBuilder`. pdfrx_web's `<pdfrx-viewer>` emits `load` / `error` events but ships no progress/error UI and no download-progress surfacing in the viewer. |
| Custom scroll physics | ⏸️ | Upstream `scrollPhysics` + Instant/Physics delegates. pdfrx_web has a fixed inertia model. |

---

## Viewer — links

| Feature | Status | Notes |
|---|---|---|
| Link tap handler | ❌ | Upstream `PdfLinkHandlerParams.onLinkTap`. pdfrx_web opens external URLs with `window.open(...)` and in-document dests directly, with no app hook to intercept. |
| Link styling / custom painter | ◐ | pdfrx_web paints a fixed hover highlight. Upstream exposes `linkColor`, `customPainter`, `linkWidgetBuilder`. Auto-link detection is implemented in both. |

---

## Viewer — text selection

pdfrx_web implements selection painting, A/B handles, the magnifier, word
selection, select-all, copy, and (new) selection-change notification with
on-demand text/geometry. Remaining gaps:

| Feature | Status | Notes |
|---|---|---|
| Programmatic selection set / restore | ❌ | Upstream `PdfTextSelectionDelegate.setTextSelectionPointRange(range)` and `selectWord(position)`. pdfrx_web can `selectAll()` and select words via gesture, but has no public API to set/restore an arbitrary range (e.g. for save/restore). |
| Copy-permission gating | ❌ | Upstream `isCopyAllowed` (from document permissions) gates copy. pdfrx_web's `copySelection()` does not check permissions. |
| Context-menu customization | ◐ | pdfrx_web shows a fixed Copy / Select-All menu. Upstream `buildContextMenu` / `customizeContextMenuItems` let the app replace/extend it. |
| Selection-handle / magnifier customization | ◐ | pdfrx_web styling is fixed (`selectionColor`, `handleColor`). Upstream `buildSelectionHandle`, `calcSelectionHandleOffset`, and `PdfViewerSelectionMagnifierParams` are extensively customizable. |
| Selection-handle pan callbacks | ❌ | Upstream `onSelectionHandlePanStart/Update/End`. |
| Text semantics / accessibility | ⏸️ | Tied to the deliberate **no-DOM-text-layer** design: selection is painted on the canvas, so there is no selectable/greppable DOM text or screen-reader text semantics (upstream `forceEnableTextSemantics`). This is a conscious trade-off, not an oversight. |

---

## Viewer — search

pdfrx_web's `PdfTextSearcher` reaches near-parity: incremental cross-page
search, prev/next/index navigation, live-growing matches, progress, and
match/active-match highlight painting.

| Feature | Status | Notes |
|---|---|---|
| Match highlight color config | ◐ | pdfrx_web hardcodes the highlight colors. Upstream `matchTextColor` / `activeMatchTextColor`. |
| `searchingPageNumber` progress detail | ◐ | pdfrx_web exposes `searchProgress`; upstream additionally reports which page is being scanned. |

---

## Rendering behavior

Roughly at parity: pdfrx_web uses a two-tier bitmap cache (a scale-capped base
image per page plus a debounced sharp patch over the visible region when zoomed
in), which is the equivalent of upstream's partial/high-res-on-zoom rendering.

| Feature | Status | Notes |
|---|---|---|
| Cache/preview tuning knobs | ◐ | Upstream exposes `maxImageBytesCachedOnMemory`, `onePassRenderingSizeThreshold`, `enableLowResolutionPagePreview`, caching delays, cache extents. pdfrx_web's budgets/delays are fixed constants. |
| Per-page decoration builder | ◐ | pdfrx_web has `pageDropShadow`, `pageBorder`, and `pagePaintCallbacks` / `pageBackgroundPaintCallbacks`. Upstream additionally has `decorationBuilder` on the single-page widget. |

---

## Flutter-only / architecturally different (⏸️)

These do not have — and are not expected to have — a direct pdfrx_web port; the
web package replaces them with an imperative `PdfrxViewer` class and the
`<pdfrx-viewer>` custom element.

- Flutter widgets: `PdfViewer` (+ `.asset/.file/.uri/.data/.custom`),
  `PdfPageView` (single-page widget), `PdfDocumentViewBuilder`.
- `PdfDocumentRef` family and `PdfDocumentListenable` (declarative,
  auto-disposing document references).
- `PdfViewerController` as a `ValueListenable<Matrix4>` (pdfrx_web uses plain
  getters/methods + listeners instead).
- Built-in password **dialog** widget (pdfrx_web takes a `passwordProvider`
  callback; the UI is the app's responsibility — same as upstream in practice).
- Dark / night mode color inversion (pdfrx_web has `backgroundColor` but no
  built-in page-color inversion).

---

## Summary of the top port candidates

If prioritizing, the highest-value gaps that are genuinely web-applicable:

1. **Page manipulation API** (`assemble` is already in the worker protocol — wire
   it to `PdfDocument`, add reorder/rotate/import + edit-aware `encodePdf`).
2. **Horizontal / custom layouts** (`layoutPagesHorizontal` already exists in
   core — expose a scroll-direction / `layoutPages` option).
3. **Public coordinate conversion & page hit-testing** + an **`onPageChanged`**
   notification.
4. **Link tap handler** and **programmatic selection set/restore**.
5. **Animated navigation** and **double-tap-to-zoom** with zoom snap steps.
6. **Interaction configurability** (enable/disable pan/zoom, wheel/arrow amounts,
   interaction callbacks) and **viewer-fixed overlays / scroll thumbs**.
