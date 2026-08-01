# Changelog

All notable changes to the `@pdfrx/*` packages are documented here.

The five packages (`@pdfrx/engine`, `@pdfrx/viewer-core`, `@pdfrx/viewer`,
`@pdfrx/react`, and `@pdfrx/colab`) share one version, so each entry below
covers the whole workspace. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.27.0] - 2026-08-02

### Changed

- Replaced `PdfrxEngine.createFromImages()` with
  `PdfDocument.createPagesFromImages()`, which creates one unplaced page per
  image in a single worker round trip and leaves final insertion, ordering, or
  omission to `PdfDocument.setPages()`.
- Renamed `PdfCreateFromImagesOptions` to
  `PdfCreatePagesFromImagesOptions`, removed its document-level `sourceName`
  option, and migrated React image-file opening, examples, tests, and engine
  documentation to the document-centric workflow.

### Added

- Added a PDFium integration test covering image-page creation, unplaced-page
  behavior, final arrangement, and encoding.

## [0.26.0] - 2026-08-02

### Changed

- Replaced the page-content authoring entry points with
  `PdfDocument.createPagesFromContents()`, which creates one or more unplaced
  source pages in a single worker round trip and leaves their final insertion,
  ordering, or omission to the synchronous `PdfDocument.setPages()` API.
- Removed `PdfrxEngine.createFromPageContents()` and
  `PdfrxEngine.insertPageContents()` and updated the page-content guide,
  multilingual Unicode example, README, worker protocol, and tests for the new
  document-centric workflow.

## [0.25.1] - 2026-08-02

### Changed

- Restored required npm package links in the root package-selection table and
  every package README, and added consistent `@pdfrx/engine`, `@pdfrx/viewer`,
  and `@pdfrx/react` navigation under each package's Next steps.
- Documented the npm-link and cross-package-navigation requirements so future
  README reorganizations preserve these discovery paths.

## [0.25.0] - 2026-08-02

### Added

- Added batched `@pdfrx/engine` APIs for creating a PDF from declarative page
  contents and inserting multiple generated pages at any page position in one
  worker round trip.
- Added ordinary PDF page-content objects for embedded Unicode text, raster
  images, rasterized emoji, and filled or stroked vector paths, including PDF
  affine transforms and registered-font reuse.
- Added a practical multilingual authoring guide covering script-aware run
  analysis, CJK language preferences, font registration, high-resolution emoji
  placement, coordinates, buffer ownership, and PDF encoding.

## [0.24.3] - 2026-08-01

### Fixed

- Rounded high-resolution patch endpoints outwards so fractional transform
  coordinates always cover the requested visible region and
  `setViewTransform()` completes for viewers larger than the browser viewport.

## [0.24.2] - 2026-08-01

### Changed

- Made full-quality render waits deterministic per transform: an explicit
  transaction passed through `invalidate`/`paint` owns each visible base or
  high-resolution patch result and the final paint, cancellation always settles
  scheduled work, later view changes return a typed `superseded` report, and
  rendering failures are propagated instead of leaving waits pending.

## [0.24.1] - 2026-08-01

### Added

- Added viewport-size metadata to `currentTransform`, the `currentViewSize`
  accessor, and the public `ViewTransformSnapshot` type for portable saved
  views.

### Changed

- Made `setViewTransform()` preserve the captured composition when restoring a
  view into a differently sized viewer, while retaining support for legacy
  transforms with an explicit source viewport size.

### Fixed

- Limited full-quality render completion waits to page regions actually exposed
  through the browser viewport and clipping ancestors, so an oversized React
  viewer no longer waits for off-screen content.

## [0.24.0] - 2026-08-01

### Added

- Added `setViewTransform()` and `waitForRender()` to restore an initial view
  and wait until every visible page region has been painted at full quality,
  including high-resolution patches and navigation animation completion.

### Changed

- Documented complete PDF load, initial-page or saved-transform restoration,
  and full-quality render-wait workflows.
- Documented how to make both the viewer canvas and the all-in-one React app
  transparent so an embedding application's background remains visible.

## [0.23.2] - 2026-07-31

### Fixed

- Allowed CSS alpha colors, including `transparent`, to reveal the embedding
  application's background around PDF pages, including after live option
  changes.

## [0.23.1] - 2026-07-29

### Changed

- Made the text-selection Markup command open its subtype-and-color submenu
  directly instead of reapplying the previously selected markup style.
- Split the React annotation-toolbar guide into a dedicated illustrated topic
  document and added screenshots to the documentation.

### Fixed

- Kept raster image annotations visible when their pages are reordered.

## [0.23.0] - 2026-07-29

### Added

- Added opt-in local filesystem font discovery for Node.js, Bun, and Deno,
  including automatic Windows, macOS, and Linux font-directory detection,
  internal font-name indexing, weight/style matching, and lazy registration of
  missing PDF fonts.
- Added an optional server-side disk cache for the local-font metadata index and
  explicitly registered font bytes, with cache validation and documented Deno
  permission requirements.

## [0.22.3] - 2026-07-29

### Changed

- Removed the obsolete feature-parity document.

### Fixed

- Invalidated persisted font substitutions after fallback-mapping changes so
  corrected CJK serif and sans-serif classification takes effect for returning
  users, and documented manual cache recovery for custom resolvers.

## [0.22.2] - 2026-07-29

### Added

- Added optional horizontal and two-page viewer layouts, fullscreen controls,
  rectangular capture, and marquee zoom APIs and React controls.
- Added Highlight, Underline, Squiggly, and StrikeOut creation from the current
  text selection, including non-destructive markup preview APIs.
- Added a localized React text-markup matrix that previews each subtype/color
  combination on hover or keyboard focus and remembers the last applied style.

### Changed

- Made selection-menu line markup use opaque, higher-contrast colors while
  retaining translucent pastel colors for Highlight.
- Improved read-only Note popups and the visibility and rendering consistency of
  transparent, highlighted, underlined, squiggly, and struck-out annotations.
- Expanded TypeDoc comments for public parameters and return values across the
  workspace.

### Fixed

- Fixed annotation history, overlay refresh, selection, and synchronization
  collisions when different PDF pages contain annotations with the same
  page-local id.
- Kept text-markup preview and committed SVG geometry consistent, including the
  underline baseline and squiggly wave shape.

## [0.22.1] - 2026-07-28

### Changed

- Changed mixed annotation selections to show the union of applicable property
  controls. Each control derives its value from, and applies edits only to,
  annotations that support that property.
- Disabled browser printing on iOS/iPadOS, where WebKit can replace the
  rasterized PDF preview with a snapshot of the complete viewer UI. The
  standard React print button is omitted there, and `usePdfPrint()` now exposes
  `isSupported`; saving/downloading the PDF remains available.

### Fixed

- Kept raster image annotations visible after a drag commits and the annotation
  overlay reloads, while preserving their PDF appearance streams.
- Fixed annotation-mode touch behavior so empty-space swipes pan the document,
  touches starting on annotations move the object, and iOS pinch gestures do
  not escape into browser page zoom.
- Extended iOS page-zoom prevention to React toolbar popups rendered through
  portals, link dialogs, sidebars, scrims, and context menus.
- Kept transparent annotation guide borders synchronized with live drag
  previews.
- Kept the image-insertion button active until insertion completes, returned
  link insertion to object-selection mode on completion, and cleared link mode
  when insertion is cancelled.
- Removed ineffective opacity controls from pen, line, and arrow selections.

## [0.22.0] - 2026-07-28

### Added

- Added `PdfDocument.prepareFreeTextAppearance()` and the standalone
  `prepareFreeTextAppearance()` API for grapheme-aware FreeText preparation,
  language-sensitive CJK font runs, text measurement and wrapping, and
  rasterized emoji image runs.
- Added replaceable text-measurement, font-resolution, emoji-rendering,
  emoji-asset-source, and asset-cache services for browser, server, offline,
  and application-specific integrations.
- Added automatic browser-native emoji rendering with a lazily downloaded,
  revision-pinned Noto Emoji PNG fallback. Noto assets are not bundled; browser
  downloads use memory plus IndexedDB caching and server defaults use
  process-local memory caching.
- Added a text, language, and emoji appearance guide covering language
  selection, Linux native-font setup, self-hosted assets, persistent caches,
  custom renderers, and licensing considerations.

### Changed

- Moved the viewer's committed FreeText appearance preparation onto the shared
  engine pipeline while retaining Canvas measurement and the existing
  downloadable-font resolver in the browser integration.
- Expanded `PdfAnnotationSpec` and FreeText appearance API references with
  rationale, complete authoring examples, language-source guidance, runtime
  behavior, and direct links to the detailed guide.
- Documented logical page proxies, cheap page rearrangement, cross-document
  page composition, and materialization as first-class architecture rather
  than only worker-protocol details.
- Documented partial React localization overrides and clarified how React
  locale settings contribute to FreeText language selection.
- Reorganized package documentation around concise READMEs, detailed topic
  guides, and direct generated API-reference links.
- Kept links from generated TypeDoc API pages to topic guides on GitHub's
  rendered Markdown view instead of copying raw Markdown into the docs site.

## [0.21.0] - 2026-07-27

### Added

- Added a selection-following annotation property popup to the React toolbar
  for one or multiple selected annotation regions.
- Added `PdfrxViewer.getSelectedAnnotationClientRect()` for positioning
  selection UI.
- Added editable Link annotation creation and target editing, including
  selection, movement, resize, synchronization, export, and automatic-link
  detection controls.
- Added `PdfrxViewer.addLinkToSelection()` and the localized **Add link**
  text-selection context-menu action.

### Changed

- Moved annotation stroke, fill, opacity, thickness, and text-property controls
  out of the main React annotation toolbar and into the floating selection
  popup.
- Fixed touch highlight palettes so Android Chrome keeps the palette open on
  the first tap and applies the first tapped color before focus changes dismiss
  it.
- Made empty-area touch long presses open the viewer context menu directly and
  disabled the native iOS canvas callout.
- Kept annotation history shortcuts working after operating the floating
  property popup, while preserving native Undo inside text inputs.
- Made ordinary page and annotation interactions leave the viewer focused so
  keyboard shortcuts continue working after a click.
- Kept nested property palettes, sliders, alignment controls, and expanded
  custom-color editors inside the viewport by flipping and shifting them.
- Added live hover previews for stroke, fill, no-fill, text colors, and
  horizontal/vertical text placement in the floating annotation property popup
  without writing history until the user selects a value.
- Added explicit object/text interaction toggles and kept object-mode
  `Ctrl`/`Cmd`+`A` scoped to annotation selection.
- Kept effectively invisible annotation objects discoverable with editing-only
  guide borders, while excluding those guides from selection-popup positioning.
- Positioned selection property popups and their nested panels away from the
  selected object according to its viewport half, with viewport clamping when
  neither side has enough room.
- Matched fixed annotation-toolbar buttons to the main toolbar's 30px size on
  touch devices, removed redundant separators and empty popup spacing, and
  collapsed unsupported mixed selections to the delete action.

### Fixed

- Fixed FreeText fallback-font export and bounded document font-data retention
  so repeated editing does not grow memory indefinitely.

## [0.20.0] - 2026-07-27

### Added

- Added CJK-aware fallback-family classification that combines PDF charset,
  pitch/family metadata, and requested family names, including public
  `isRomanFamily` and `isScriptFamily` helpers.
- Added editable PDF Link annotations to the ordinary annotation CRUD,
  selection, movement, resize, synchronization, and export paths, including
  `linkTarget` on annotation objects and specs.
- Added `PdfrxViewerOptions.autoLinkDetection` and the corresponding React
  option so transient URL detection can be disabled independently of
  persisted Link annotations.
- Added explicit object-selection and text-selection controls to the React
  annotation toolbar, with `Alt`/`Option` temporarily inverting the effective
  mode and the displayed toggle.

### Changed

- Merged adjacent text-selection rectangles by visual line and rendered
  selection highlights with Multiply blending, reducing seams and preserving
  legibility over page content.
- Split normal viewing/text selection from annotation-object interaction.
  Opening the React annotation toolbar now enters object mode, closing it
  returns to text-selection mode, and object mode uses primary-button drags
  for movement, anchors, and marquee selection.
- Made persisted Link annotations ordinary editable annotation objects while
  keeping auto-detected URLs transient and active only in viewing mode.
- Changed empty-space clicks to clear both text and object selections, except
  that `Ctrl`/`Cmd` preserves object selection in object mode.
- Portaled the text-selection context menu to the document foreground so page
  and annotation layers cannot clip or cover it.
- Changed rectangle text editing so typing or IME composition on a single
  selected rectangle starts inline editing, double-click works across a
  selected rectangle's bounds, and committing re-arms first-character input.
- Removed the native textarea resize grip from annotation text editing.

### Removed

- Removed the selected-rectangle **Add text** banner and its localization/API
  surface.

### Fixed

- Fixed text-selection popup actions in annotation-object mode.
- Fixed outside-click text commits when the textarea has scrollbars and
  prevented the commit click from also replacing the current selection.
- Fixed first-character IME composition, repeated keyboard editing after a
  commit, rectangle double-click editing, and rectangle anchor resizing while
  the hidden IME-ready editor is armed.

## [0.19.1] - 2026-07-27

### Changed

- Clarified that `PdfPage.dest()` is the simplest way to construct
  `PdfDest`, `PdfDestById`, and `PdfDestByPageNumber` values, including what
  the opaque logical page ID represents.
- Documented how reusing the same `PdfPage` in `setPage()` / `setPages()` makes
  ID-based destinations ambiguous, and how the zero-copy
  `PdfPage.duplicate()` API gives repeated placements distinct identities.

## [0.19.0] - 2026-07-27

### Added

- Added editable document outlines and page Link annotations through
  `PdfDocument.setOutline()` and `PdfPage.setLinks()`, with immutable logical
  reads before the changes are written to the physical PDF.
- Added opaque logical `PdfPage.id` values, zero-copy `PdfPage.duplicate()`,
  `PdfPage.dest()`, and ID- or page-number-based immutable `PdfDest` values so
  destinations can either follow a page or remain fixed to a position.
- Added `PdfDocument.hasPendingChanges` and a single
  `PdfDocument.materialize()` boundary for pending page, outline, and Link
  edits.

### Changed

- Renamed `PdfDocument.createCopy()` to `createMaterializedCopy()` and replaced
  its `clone` / `compact` mode with a `preserve` / `rebuild` catalog policy,
  making explicit that the returned document is fully materialized while the
  source document and its pending edits remain unchanged.
- Changed `setPages()`, `setPage()`, `setOutline()`, and `setLinks()` to update
  logical state first; `materialize()` and `encodePdf()` reconcile that state
  with the worker's physical PDF object graph.
- Expanded the engine's public API and worker-protocol documentation, including
  the distinction between logical page placements and physical source pages
  used by destinations and raw-object APIs.

### Removed

- Removed `PdfDocument.assemblePages()` in favor of the unified
  `PdfDocument.materialize()` API.

## [0.18.0] - 2026-07-26

### Added

- Added `PdfOpenDataOptions.transferData` so callers can explicitly retain
  in-memory PDF input while the engine transfers an internal copy.

### Changed

- Transferred full `ArrayBuffer` inputs to the PDF worker by default and kept
  password-protected sources behind an opaque worker handle, so password
  retries send only the new password rather than copying the complete PDF.

### Fixed

- Released native and virtual-file allocations after failed in-memory password
  attempts and discarded worker-retained source bytes when opening is
  cancelled.

## [0.17.0] - 2026-07-26

### Added

- Added `compact` modes to `PdfDocument.createCopy()` and `encodePdf()` to
  rebuild the arranged pages in a fresh PDF and omit objects not reachable from
  those pages, whether inherited from the source or produced by later edits.
- Added `PdfAnnotationMutationOptions.preserveAppearance` for geometry-only
  raster Stamp updates.

### Changed

- Rebuilt collaborative exports through a compact page import before restoring
  outlines and AcroForms.
- Consolidated PDF serialization around `PdfDocument.createCopy({ mode })` and
  `encodePdf({ mode })`, replacing the copy/compact method variants.
- Consolidated viewer drawing state around `setAnnotationTool()`,
  `getAnnotationTool()`, and `addAnnotationToolChangeListener()`.

### Removed

- Removed compatibility-only viewer APIs: `AnnotationMode`,
  `setAnnotationSelectMode()`, the `freeText` drawing-tool alias, and the
  annotation-specific undo/redo aliases.
- Removed inline raster pixels from the collaboration annotation protocol;
  raster appearances now use relay-backed `appearanceImageSource` exclusively.

### Fixed

- Stopped image-annotation moves and resizes from registering the same raster
  appearance repeatedly and growing long-lived collaborative documents.

## [0.16.3] - 2026-07-26

### Added

- Added `PdfrxViewerApp.renderContent` and `PdfrxViewerAppOverrides` so host
  applications can customize editing operations while retaining the complete
  standard viewer chrome.

### Changed

- Rebuilt `CollaborativePdfViewer` directly on `PdfrxViewerApp`, leaving only
  relay-backed editing operations and collaboration notices as overrides.

### Fixed

- Kept active annotation text editors open while rendering remote updates to
  other annotations on the same page.
- Made inline annotation text-editor backgrounds fully opaque, falling back to
  white when the annotation has no fill color.
- Reported collaboration PDF export failures through the visible error banner
  instead of only logging serialization errors to the developer console.

## [0.16.2] - 2026-07-26

### Added

- Added `useImageAnnotationDrop()` so composed React viewers can reuse the
  all-in-one viewer's image classification, canvas hit testing, and
  drop-to-insert stamp behavior.

### Changed

- Encoded collaborative raster annotation appearances as alpha-preserving WebP
  for upload and persistent storage instead of sending uncompressed RGBA bytes
  through the PDF source store.
- Reduced the collaboration viewer's outer spacing on narrow screens.

### Fixed

- Restored drop-to-insert image annotations on the collaboration viewer's page
  surface by composing the shared React drop behavior.

## [0.16.1] - 2026-07-26

### Fixed

- Focused annotation text editors synchronously from the activating gesture so
  iOS opens its software keyboard for Note and FreeText editing.

## [0.16.0] - 2026-07-26

### Added

- Added horizontal and vertical text placement to `AnnotationStyle`, with a
  localized 3 × 3 alignment picker for rectangle and FreeText annotations.
- Added full HSV custom-color selection, direct `#RRGGBB` input, four persisted
  LRU custom-color slots, live selection preview, and white to the annotation
  toolbar palette.
- Added toolbar deletion and keyboard movement of selected annotations; arrow
  keys move by one screen pixel and Shift+arrow moves by ten.

### Changed

- Synchronized annotation toolbar controls with the current selection, showing
  mixed values as unselected while retaining explicit user choices as defaults
  for new objects.
- Persisted annotation color, fill, text style, opacity, thickness, alignment,
  and custom colors in `localStorage` for the next viewer session.
- Matched inline text-editor foreground and background colors to the annotation
  and refined the mobile annotation toolbar and hidden drawer positioning.

### Fixed

- Removed stale hover highlighting after deleting an annotation and accepted
  the first `Delete` key press after initial page display.
- Corrected the centered empty-rectangle text affordance so its label is not
  clipped.
- Avoided duplicate PDF loading when joining collaboration sessions and
  prevented compact page navigation from stealing focus on mobile.

## [0.15.3] - 2026-07-25

### Changed

- Moved collaborative raster-annotation payloads to the immutable HTTP
  `PUT`/`GET` side channel. WebSocket previews and geometry updates now carry
  only compact annotation state, and received raster bytes are cached by source
  ID.
- Reused raster appearance buffers and rendered image data URLs while
  translating annotations, avoiding repeated multi-megabyte clones and
  encodes during interaction.

### Fixed

- Prevented annotation objects from being dragged completely outside a page;
  oversized objects retain a recoverable one-pixel strip.
- Treated mobile `pointercancel` as a cancelled annotation move instead of
  committing its sometimes-zero coordinates and jumping the object to the
  page origin.

## [0.15.2] - 2026-07-25

### Added

- Added the reusable React `PdfViewerLayout` chrome with the standard
  wide-screen sidebar and narrow-screen overlay drawer behavior.

### Changed

- Added thumbnails and outline tabs to the collaborative viewer sidebar and
  made it toggleable from the standard toolbar.
- Reduced touch annotation anchors from 24 to 16 screen pixels so they obscure
  less of small objects while remaining larger than mouse anchors.

### Fixed

- Kept context menus and text-highlight palettes within all four viewport
  edges, including when the viewer itself is partially off-screen.
- Replaced SVG screen-CTM annotation hit coordinates with client-rectangle
  mapping, avoiding incorrect object selection and dragging on iOS Safari.
- Updated the documentation toolchain's transitive `brace-expansion`
  dependency to 5.0.8, resolving its unbounded-expansion denial-of-service
  advisory.

## [0.15.1] - 2026-07-25

### Fixed

- Preserved in-progress annotation text editing, including IME composition,
  while remote collaboration updates refresh page annotation overlays.

## [0.15.0] - 2026-07-25

### Added

- Added persistent explicit, page-fit, and width-fit zoom modes, plus a popup
  page navigator for compact toolbar layouts.
- Added a localized **Add text** affordance for selected empty rectangles and
  unified rectangle/FreeText inline editing.

### Changed

- Annotation selection is now always available: primary click selects objects,
  primary drag moves or resizes them, and secondary drag performs marquee
  selection without opening a trailing context menu.
- Annotation creation and manipulation now share coordinate snapping, and
  shape-aware hit testing covers ink, lines, arrows, and unfilled shapes.
- The annotation toolbar, narrow-screen search row, and error banner now use
  reduced-motion-aware enter and leave transitions.

### Fixed

- Kept thumbnail navigation targets visible with an appropriate scroll margin.
- Restored annotation color and slider popups above the document after adding
  animated toolbar rows.
- Matched FreeText border thickness to PDFium and other PDF viewers.

## [0.14.0] - 2026-07-24

### Added

- Added configurable browser image decoding for formats such as HEIC/HEIF,
  shared by file opening and image annotation insertion.

### Changed

- Straight line and arrow annotations now use distance-to-segment selection
  with a wider touch target, including segment-aware marquee selection.

### Fixed

- Preserved the intrinsic resolution of raster image annotations when reading
  their PDF appearances and across repeated move/resize operations, preventing
  progressive resampling and visible quality loss.

## [0.13.0] - 2026-07-24

### Added

- Added printable image stamp annotations from page drops, with proportional
  page fitting and constrained interactive resizing.
- Added vector PDF appearances for supported static SVG paths and basic shapes,
  with raster fallback for unsupported SVG content.
- Added an image picker to the React annotation toolbar. Picked images are
  centered on the current page and use the same bounded sizing as dropped
  images.

## [0.12.0] - 2026-07-24

### Added

- Added reversible engine mutation payloads for annotation and form changes,
  including bulk `setFormFieldValues()` transactions that report direct and
  calculated field before/after values together.

### Changed

- Direct local `PdfDocument` page edits and `PdfPage` annotation CRUD now join
  an attached viewer's chronological annotation, form, and page Undo/Redo
  history.
- Form transactions are serialized, carry origin/transaction/actor metadata,
  and are recorded as one viewer history entry, while remote, restore, replay,
  and page-materialization changes remain outside local history.
- Collaborative choice-field values now retain selected option labels as
  arrays, including for single-select controls.

### Fixed

- Fixed Undo for combo/list fields whose PDF export value differs from the
  displayed option label.

## [0.11.0] - 2026-07-24

### Added

- Added typed raw PDF-object inspection and transactional editing to
  `@pdfrx/engine`, backed by the custom PDFium build from
  `espresso3389/pdfium-binaries`. Convenience operations cover dictionaries,
  arrays, streams, indirect objects, and references, with opt-in copy-based
  atomic commits.
- Added viewer refresh controls for page-level rerendering, document-level
  cache and layout refresh, and full document reload after custom PDF edits.
- The collaboration example now accepts JPEG, PNG, WebP, and GIF images as
  single-page sessions, supports drag-and-drop session creation, and requests
  passwords for protected PDFs. Passwords are shared with session clients for
  decoding without being displayed in the UI.

### Changed

- Moved page-scoped annotation loading and CRUD from `PdfDocument` to
  `PdfPage`. Document-level APIs now focus on arrangement-wide queries,
  snapshots, synchronization batches, and change events.
- Imported and duplicate page placements now share their source-page annotation
  state while emitting changes for every affected arrangement placement.
- Removed the public `PdfPage.withPageNumber()` helper. `setPages()` assigns
  page numbers from array order, while the documented `rotated*()` helpers are
  applied through `setPage()` or `setPages()`.
- Simplified the collaboration entry screen: visitors without a session query
  create a session directly instead of choosing between create and join.

### Fixed

- Open protected PDFs through `@pdfrx/engine` password handling instead of
  rejecting valid files as `invalid-pdf`.

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

[Unreleased]: https://github.com/espresso3389/pdfrx_web/compare/v0.25.1...HEAD
[0.27.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.25.1...v0.26.0
[0.25.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.24.3...v0.25.0
[0.24.3]: https://github.com/espresso3389/pdfrx_web/compare/v0.24.2...v0.24.3
[0.24.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.24.1...v0.24.2
[0.24.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.23.2...v0.24.0
[0.23.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.23.1...v0.23.2
[0.23.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.23.0...v0.23.1
[0.23.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.22.3...v0.23.0
[0.22.3]: https://github.com/espresso3389/pdfrx_web/compare/v0.22.2...v0.22.3
[0.22.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.22.1...v0.22.2
[0.22.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.22.0...v0.22.1
[0.22.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.19.1...v0.20.0
[0.19.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.16.3...v0.17.0
[0.16.3]: https://github.com/espresso3389/pdfrx_web/compare/v0.16.2...v0.16.3
[0.16.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.16.1...v0.16.2
[0.16.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.15.3...v0.16.0
[0.15.3]: https://github.com/espresso3389/pdfrx_web/compare/v0.15.2...v0.15.3
[0.15.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.10.1...v0.11.0
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
