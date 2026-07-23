# Changelog

All notable changes to the `@pdfrx/*` packages are documented here.

The five packages (`@pdfrx/engine`, `@pdfrx/viewer-core`, `@pdfrx/viewer`,
`@pdfrx/react`, and `@pdfrx/colab`) share one version, so each entry below
covers the whole workspace. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.1] - 2026-07-23

### Changed

- The private collaboration example now uses Node.js for its standard
  development and relay start scripts.
- Updated the development toolchain to TypeScript 7, Vite 8, Vitest 4,
  jsdom 29, and the latest compatible React, type-definition, and test tooling
  releases. TypeDoc uses an isolated TypeScript 6 installation until it adds
  TypeScript 7 peer support.

## [0.10.0] - 2026-07-23

### Added

- `@pdfrx/colab` now accepts injectable collaboration transport hooks for
  authenticated/custom WebSocket creation, credentialed source fetches, and
  application-specific source URL routing.
- Added a deployable single-viewer collaboration application with a persistent
  relay, invite links, source-PDF endpoints, reconnect recovery, and live
  annotation drag previews.
- Added right-button drag panning to the canvas viewer.

### Changed

- Annotation editing now provides live move/resize previews, snapping guides,
  live marquee selection, unified rectangle/FreeText editing, independent text
  styling, and more reliable selection controls.
- Right-button and two-finger panning now honor `panEnabled`, `panAxis`,
  `zoomEnabled`, and the interaction start/end callback lifecycle consistently.

### Fixed

- Ignored accidental pen clicks that did not produce a drawable stroke.
- Initialized both touch points when a pinch starts, so the first two-finger
  movement updates the view immediately.

## [0.9.0] - 2026-07-23

### Added

- Published `@pdfrx/colab`, a reusable React collaboration viewer package with
  relay-session protocols, stable virtual-page placement, annotation and form
  synchronization, mixed-source PDF export, outline merging, and the
  `CollaborativePdfViewer` component. The two-client playground now lives in
  `examples/colab` and runs through `npm run dev:colab`.
- Added external annotation synchronization APIs, including annotation snapshot
  serialization, actor/revision metadata, mutation origins, and import support
  for applying remote changes without creating feedback loops.
- Added virtual page-editing primitives across the engine, viewer core, viewer,
  and React packages. Applications can insert, remove, rotate, and reorder
  stable page placements while preserving document generation and export state.
- Added explicit page-relative or upright text orientation metadata for FreeText
  annotations and form widgets. Generated appearances, SVG overlays, native form
  controls, and collaborative transport now preserve the intended orientation
  through page rotation.
- Added a light/dark/system theme switcher to the React example.

### Fixed

- Corrected rotated FreeText clipping and layout for non-square annotation
  rectangles.
- Corrected native form-control sizing and font calculation after 90°/270° page
  rotation.
- Kept the colab example within the viewport and aligned its editing toolbar and
  history policy with the standard React viewer configuration.

## [0.8.0] - 2026-07-22

### Added

- **Annotation support.** Read, create, edit, and export PDF annotations —
  freehand ink, shapes (rectangle/ellipse/line/arrow), text markup (highlight/
  underline/strikeout), and notes/free text — through a new engine API
  (`PdfDocument.loadAnnotations()` / `addAnnotation()` / `updateAnnotation()` /
  `removeAnnotation()` / `importAnnotations()`, the `annotationsChanged` event),
  an SVG overlay in the viewer with drawing/selection tools
  (`interactiveAnnotations`, `setAnnotationTool()`), and React bindings (the
  `useAnnotations` hook plus `PdfAnnotationToolbar`). Created annotations get a
  generated appearance stream, so they persist through `encodePdf` and render in
  other PDF viewers.
- Annotation editing gained **unlimited undo/redo** (`PdfrxViewer.undoAnnotation()`
  / `redoAnnotation()`, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, `useAnnotations().undo` /
  `redo` / `canUndo` / `canRedo`, and toolbar buttons), and **draggable anchor
  handles** on a selected annotation (a constant 8px on-screen, the sole
  selection indicator): pen/rectangle/ellipse show eight bounding-box handles and
  drag to scale the whole shape, while free-form lines/polygons keep
  per-vertex handles; dragging the body still moves the whole annotation.
- **Marquee multi-selection** (`PdfrxViewer.setAnnotationSelectMode`): in select
  mode, drag empty page area to rubber-band-select every overlapping annotation,
  then move or resize the whole group together via a single group bounding box.
  Undo/redo now batches a multi-object edit (move/resize/delete of a selection)
  into one atomic step.
- Picking a color or stroke width in the toolbar now also **restyles every
  selected annotation** (`PdfrxViewer.applyStyleToSelection`), as one undo step.
- **Separate stroke and fill colors.** `AnnotationStyle` gained `fillColor`
  (null = no fill), applied to rectangles/ellipses on draw and through
  `applyStyleToSelection` (tri-state: leave / clear / set). The toolbar's inline
  swatch row was replaced by two popup palette buttons — a stroke ring and a
  fill dot indicator — each opening a custom palette below the button (the fill
  palette includes "No fill"); dismissed by pick, outside click, or Escape.
- **Text highlight is now a text-markup action**, not a drawing tool: select text
  and choose *Highlight* from the right-click menu to add a proper `Highlight`
  annotation snapped to the text lines (`PdfrxViewer.highlightSelection` /
  `canHighlightSelection`; a `highlight` context-menu string in all locales). The
  old rectangle-drag Highlight tool was removed from the toolbar.
- The React `PdfAnnotationToolbar` is now a set of **mutually-exclusive mode
  toggles** — Text (normal selection), Select (objects), and each drawing tool —
  and takes an `onClose` prop; it restores text-selection mode when it unmounts.
  `PdfrxViewerApp` gained an **Annotate** toolbar button (right of search, set
  apart from print/open/download) that reveals the annotation toolbar — the
  `enableAnnotations` prop (default on); `PdfToolbar` gained an `afterSearch`
  slot. The composed demo shows the same pattern with its own button. The whole
  bar is restyled to match the built-in design system: the shared stroke-icon
  set (no emoji), `pdfrx-button` sizing/hover/active states, and CSS variables
  (dark-mode aware) via new `pdfrx-annot-*` / `pdfrx-toolbar-separator` classes
  in `styles.css`.
- A reusable `PdfSaveButton` React component that serializes the current
  document (annotation and page edits included) with `encodePdf` and downloads
  it, usable in composed layouts (not just the all-in-one app).

### Changed

- The viewer paints annotations through the SVG overlay instead of the canvas by
  default (a new `'formsOnly'` render mode keeps form widgets on the canvas), so
  annotation edits never re-render the page.

## [0.7.0] - 2026-07-21

### Added

- **AcroForm form support.** Read, set, and observe form fields through a new
  engine API, fill them interactively via a native HTML overlay in the viewer,
  and consume them from React with the `useFormFields` hook (plus a form demo).
- **Form calculations.** A JS-free `AFSimple_Calculate` engine computes
  field-calculation orders (sum, product, average, min, max) without an
  embedded JavaScript interpreter.
- Read-only form fields render as disabled overlay controls.

### Changed

- Documented AcroForm form support, form calculations, and the arbitrary-JS
  limitation.

## [0.6.0] - 2026-07-21

### Added

- **Build PDFs from images.** `createFromImages` assembles a multi-page PDF from
  images in several formats.
- Open images as PDFs, and insert & reorder pages via thumbnail drag & drop,
  including an "Add pages" button at the end of the thumbnail strip (React).
- A default password provider and a dismissible error banner (React).

### Fixed

- Copy selection now works in non-secure contexts (mobile fix).

## [0.5.0] - 2026-07-21

### Added

- **Extensible context menu.** A `contextMenuBuilder` hook lets apps extend the
  default menu; React ships a localized menu and an example "Search the web"
  item.

## [0.4.0] - 2026-07-21

### Added

- **Localizable UI** with built-in languages and automatic detection (React).

## [0.3.0] - 2026-07-21

### Added

- The sidebar can sit on the right, with a mirrored hamburger and animated
  desktop collapse; open and download buttons are individually toggleable
  (React).
- A responsive demo nav for phones, with GitHub and npm links.
- API reference links and a package-family section in the READMEs.

### Changed

- Mobile search collapses to a button on phones, and the search ✕ closes the
  whole search row.
- Examples resolve `@pdfrx/*` to source in Vite, avoiding the `dist/` race that
  let HMR read a half-written build.

### Fixed

- The viewer repaints synchronously on resize to stop flicker.

## [0.2.2] - 2026-07-21

### Added

- **`@pdfrx/react`:** React components and hooks over `@pdfrx/viewer`.

### Changed

- Publishing moved to CI via npm trusted publishing (OIDC).
- README now leads the Usage section with React and clarifies viewer vs. react.

## [0.2.1] - 2026-07-20

### Fixed

- The engine reads its WASM assets from the package on server runtimes, starts
  the worker the way the host does, and lets the host supply the worker and base
  URL — no longer assuming a browser-only environment.
- `encodePdf` returns only the bytes written.

## [0.2.0] - 2026-07-20

Initial public release of the `@pdfrx/*` package family: a canvas-based PDF
viewer for the browser, ported from the pdfrx viewer stack.

### Added

- **Rendering & viewing.** WASM-backed page rendering with client-side render
  queuing that cancels renders for pages scrolled out of view; RGBA output; fit
  modes, configurable min zoom, and page decoration.
- **Navigation & interaction.** Animated navigation, zoom snap steps, double-tap
  zoom, horizontal and custom page layouts, gesture callbacks, `panAxis`,
  viewer-fixed overlays, and `onViewerReady` / `onViewSizeChanged` /
  `onPageChanged` callbacks.
- **Text & search.** Text selection with change notifications and
  programmatic set/restore, public coordinate conversion and page hit-testing,
  `onLinkTap`, and an exposed `PdfTextSearcher.searchingPageNumber`.
- **Page manipulation.** Assemble / reorder / rotate / import pages via a single
  `setPages` API, using proxy pages so rearrangement does not rebuild the PDF and
  does not leave stale text/links.
- **Permissions.** Permission helpers, copy gating, and search-highlight color
  configuration.
- **Missing-font fallback** via Google Fonts (port of
  `CompositeGoogleFontsResolver`).
- Example app with local file open (picker + drag & drop), open-by-URL, keyboard
  navigation, text search, destination navigation, thumbnails/outline, printing,
  and touch-driven page reordering.
- Vendored pdfium engine assets so a plain clone builds and runs.
- TypeDoc API reference with a GitHub Pages deploy workflow, per-package READMEs,
  and an MIT license.

[Unreleased]: https://github.com/espresso3389/pdfrx_web/compare/v0.10.1...HEAD
[0.10.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/espresso3389/pdfrx_web/releases/tag/v0.2.0
