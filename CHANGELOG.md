# Changelog

All notable changes to the `@pdfrx/*` packages are documented here.

The four packages (`@pdfrx/engine`, `@pdfrx/viewer-core`, `@pdfrx/viewer`,
`@pdfrx/react`) share one version, so each entry below covers the whole
workspace. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.7.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/espresso3389/pdfrx_web/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/espresso3389/pdfrx_web/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/espresso3389/pdfrx_web/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/espresso3389/pdfrx_web/releases/tag/v0.2.0
