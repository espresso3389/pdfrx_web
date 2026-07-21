/**
 * @packageDocumentation
 * React bindings for the pdfrx canvas-based PDF viewer.
 *
 * Three layers, pick the one that fits:
 *
 * 1. **All-in-one** — {@link PdfrxViewerApp} is the whole thing: toolbar,
 *    sidebar with thumbnails and outline, search, print. One component, one
 *    `src` prop.
 * 2. **Composable parts** — {@link PdfrxProvider} plus
 *    {@link PdfViewerSurface}, {@link PdfToolbar}, {@link PdfSidebar},
 *    {@link PdfSearchBox} and friends, arranged however your layout needs.
 *    Import `@pdfrx/react/styles.css` for their default look.
 * 3. **Headless** — {@link PdfrxProvider} plus the hooks
 *    ({@link usePdfSearch}, {@link usePdfOutline}, {@link usePdfPageThumbnail},
 *    …) with UI entirely your own.
 *
 * All three need the engine's WASM assets: point `wasmModulesUrl` at a
 * directory holding `pdfium_worker.js` and `pdfium.wasm` (copy them from
 * `node_modules/@pdfrx/engine/assets/`, or use the jsDelivr CDN).
 *
 * @example All-in-one
 * ```tsx
 * import { PdfrxViewerApp } from '@pdfrx/react';
 * import '@pdfrx/react/styles.css';
 *
 * <PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="/pdfium/" style={{ height: '100vh' }} />
 * ```
 *
 * @example Composed
 * ```tsx
 * <PdfrxProvider src="/manual.pdf" wasmModulesUrl="/pdfium/">
 *   <PdfToolbar />
 *   <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
 *     <PdfSidebar />
 *     <PdfViewerSurface style={{ flex: 1 }} />
 *   </div>
 * </PdfrxProvider>
 * ```
 */

// --- Core ---
export { PdfrxProvider, usePdfrxStore, useOptionalPdfrxStore, type PdfrxProviderProps } from './context.js';
export { PdfViewerSurface, type PdfViewerSurfaceProps } from './surface.js';
export { PdfrxViewerStore } from './store.js';
export { ThumbnailCache } from './thumbnail-cache.js';
export { normalizeSource, type PdfSource, type NormalizedPdfSource } from './source.js';
export { isImageFile, isPdfFile, looksLikePdf, imageBytesToPdf, openFileAsDocument } from './file-open.js';
export { defaultPdfrxStrings, usePdfrxStrings, type PdfrxStrings } from './strings.js';
export {
  buildDefaultContextMenu,
  type PdfReactContextMenuBuilder,
  type PdfContextMenuHelpers,
} from './context-menu.js';
export {
  builtinPdfrxStrings,
  builtinPdfrxLocales,
  resolvePdfrxStrings,
  type PdfrxLocale,
} from './locales.js';

// --- Components ---
export { PdfrxViewerApp, type PdfrxViewerAppProps } from './components/viewer-app.js';
export { PdfToolbar, type PdfToolbarProps } from './components/toolbar.js';
export { PdfSidebar, type PdfSidebarProps, type PdfSidebarTab } from './components/sidebar.js';
export { PdfThumbnailList, type PdfThumbnailListProps } from './components/thumbnail-list.js';
export { PdfOutlineTree, type PdfOutlineTreeProps } from './components/outline-tree.js';
export { PdfSearchBox, type PdfSearchBoxProps } from './components/search-box.js';
export { PdfAnnotationToolbar, type PdfAnnotationToolbarProps } from './components/annotation-toolbar.js';
export { PdfSaveButton, type PdfSaveButtonProps } from './components/save-button.js';
export {
  PdfPageIndicator,
  PdfZoomControls,
  PdfPrintButton,
  PdfLoadingBar,
  type PdfControlProps,
} from './components/toolbar-parts.js';

// --- Hooks ---
export { usePdfrxViewer } from './hooks/use-pdfrx-viewer.js';
export { useDocumentGeneration, usePdfPagesRevision } from './hooks/use-document-generation.js';
export { usePdfDocument, type PdfDocumentState } from './hooks/use-pdf-document.js';
export { usePdfNavigation, type PdfNavigation } from './hooks/use-pdf-navigation.js';
export { usePdfZoom, type PdfZoom } from './hooks/use-pdf-zoom.js';
export { usePdfOutline, type PdfOutlineState } from './hooks/use-pdf-outline.js';
export { useFormFields, type PdfFormFieldsState } from './hooks/use-form-fields.js';
export { useAnnotations, type PdfAnnotationsState } from './hooks/use-annotations.js';
export { usePdfSearch, type PdfSearch } from './hooks/use-pdf-search.js';
export { usePdfSelection, type PdfSelection } from './hooks/use-pdf-selection.js';
export { usePdfPageThumbnail, type PdfPageThumbnail } from './hooks/use-pdf-page-thumbnail.js';
export { usePdfPrint, type PdfPrint } from './hooks/use-pdf-print.js';
export { useViewerSnapshot, shallowEqual, type ViewerSubscribe } from './hooks/use-viewer-snapshot.js';

// --- Re-exports, so apps rarely need to depend on @pdfrx/viewer directly ---
export type {
  PdfrxViewer,
  PdfrxViewerOptions,
  AnnotationTool,
  AnnotationStyle,
  FitMode,
  LayoutDirection,
  PanAxis,
  PdfLoadingProgress,
  PdfTextSelectionRange,
  PdfSelectedTextRange,
  SearchMatch,
  StartTextSearchOptions,
  PdfRect,
  PdfPoint,
  Offset,
  ViewTransform,
  ContextMenuBuilder,
  ContextMenuContext,
} from '@pdfrx/viewer';
export type { PdfDocument, PdfPage, PdfOutlineNode, PdfDest, PdfLink, PdfPasswordProvider } from '@pdfrx/engine';
