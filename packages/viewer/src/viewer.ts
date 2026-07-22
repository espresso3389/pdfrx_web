/**
 * Canvas-based PDF viewer shell.
 *
 * All geometry/selection logic lives in @pdfrx/viewer-core; this class owns
 * the DOM canvas, the pointer state machine, and the render loop. Text
 * selection is painted on the canvas — there is deliberately no DOM text
 * layer.
 */

import {
  PdfrxEngine,
  type PdfAnnotationObject,
  type PdfAnnotationPoint,
  type PdfAnnotationQuad,
  type PdfAnnotationRenderingMode,
  type PdfAnnotationSpec,
  type PdfDest,
  type PdfDocument,
  type PdfFontQuery,
  type PdfFormField,
  type PdfLink,
  type PdfPage,
  type PdfOpenOptions,
  type PdfOpenUrlOptions,
  type PdfOutlineNode,
  type PdfrxEngineOptions,
} from '@pdfrx/engine';
import { googleFontsResolver, type FontResolver } from './font-fallback.js';
import {
  adjustBoundaryMargins,
  anchorPoint,
  calcTransformFor,
  calcTransformForRect,
  calcVisibleRect,
  clampToBoundary,
  composeSelectedText,
  computeSelectionAnchors,
  documentRectToView,
  documentToView,
  edgeInsetsZero,
  enumerateFragmentBoundingRects,
  findTextAndIndexForPoint,
  formatText,
  getSelectedRanges,
  layoutPagesHorizontal,
  layoutPagesVertical,
  offsetToPdfPoint,
  offsetToPdfPointInDocument,
  pdfPointToOffset,
  pdfRectToRect,
  pdfRectToRectInDocument,
  rangeBounds,
  rectCenter,
  rectContains,
  rectContainsRect,
  rectHeight,
  rectInflate,
  rectIntersect,
  rectIsEmpty,
  rectOverlaps,
  rectWidth,
  selectionPointLE,
  selectWordAt,
  viewToDocument,
  type Offset,
  type PageGeometry,
  type PageLayout,
  type PdfPageText,
  type PdfPoint,
  type PdfRect,
  type Rect,
  type SelectablePage,
  type SelectionAnchors,
  type SelectionPoint,
  type Size,
  type ViewTransform,
} from '@pdfrx/viewer-core';
import { PageRenderCache } from './render-cache.js';
import { PdfTextSearcher } from './text-searcher.js';

/** Construction options for {@link PdfrxViewer}. */
export interface PdfrxViewerOptions {
  /**
   * Engine to use. If omitted, the viewer creates and owns one from
   * {@link engineOptions} and disposes it on {@link PdfrxViewer.dispose}. Pass a
   * shared engine to open several viewers against one worker; then the caller
   * owns its lifetime.
   */
  engine?: PdfrxEngine;
  /**
   * Options for the engine created when {@link engine} is not supplied. Its
   * `wasmModulesUrl` must point at a directory containing `pdfium_worker.js` and
   * `pdfium.wasm`. Defaults to `{ wasmModulesUrl: 'pdfium/' }`.
   */
  engineOptions?: PdfrxEngineOptions;
  /** Margin around/between pages in document units. Default: 8. */
  margin?: number;
  /**
   * Direction pages are laid out and scrolled: `'vertical'` (default, stacked
   * top-to-bottom) or `'horizontal'` (side-by-side). In horizontal mode a plain
   * mouse wheel scrolls sideways through the pages. Ignored when
   * {@link layoutPages} is set. Can also be changed at runtime with
   * {@link PdfrxViewer.setLayoutDirection}.
   */
  layoutDirection?: LayoutDirection;
  /**
   * Custom page-layout function, for facing/two-up/grid arrangements. Given the
   * page geometries and the resolved margin, return each page's rect (document
   * coordinates, y-down) and the total document size. When set, it fully
   * replaces the built-in vertical/horizontal layouts (so {@link layoutDirection}
   * is ignored). See {@link LayoutPagesFn}.
   */
  layoutPages?: LayoutPagesFn;
  /** Background color of the viewer. Default: '#808080'. */
  backgroundColor?: string;
  /** Selection highlight fill style. Default: 'rgba(33, 150, 243, 0.35)'. */
  selectionColor?: string;
  /** Selection handle color (touch). Default: '#2196f3'. */
  handleColor?: string;
  /** Fill style for search-match highlights. Default: 'rgba(255, 235, 59, 0.5)'. */
  matchTextColor?: string;
  /**
   * Fill style for the active (current) search-match highlight. Default:
   * 'rgba(255, 152, 0, 0.5)'.
   */
  activeMatchTextColor?: string;
  /** Maximum zoom. Default: 8. */
  maxZoom?: number;
  /**
   * Minimum zoom. When omitted, it is computed dynamically as
   * `min(`{@link PdfrxViewer.coverScale}`, `{@link PdfrxViewer.fitPageScale}`)`
   * for the current page, so you can never zoom out past
   * seeing a whole page. Set an explicit number to override that behavior.
   */
  minZoom?: number;
  /**
   * How the first page is fitted into the viewport when a document loads (and
   * on viewport resize, until the user pans/zooms). See {@link PdfrxViewer.fitToPage}.
   *
   * - `'page'` (default) — the whole first page fits within the viewport.
   * - `'width'` — the first page's width fills the viewport (top-aligned).
   * - `'height'` — the first page's height fills the viewport.
   */
  initialFit?: FitMode;
  /**
   * Drop shadow drawn behind every page (in screen space, so it looks the same
   * at any zoom). Defaults to a soft shadow; pass `null` to remove it. See
   * {@link PageDropShadow}.
   */
  pageDropShadow?: PageDropShadow | null;
  /**
   * Border drawn around every page (in screen space). Off by default; set a
   * {@link PageBorder} to enable it.
   */
  pageBorder?: PageBorder | null;
  /**
   * Custom painters invoked **behind** each page, before the page background is
   * filled — useful for custom shadows or backdrops that extend outside the
   * page. Each callback receives the canvas already transformed to document
   * coordinates and the page's document-space rect.
   */
  pageBackgroundPaintCallbacks?: PagePaintCallback[];
  /**
   * Custom painters invoked **on top of** each page's rendered content — useful
   * for watermarks, page numbers, or custom borders. Same coordinate space as
   * {@link pageBackgroundPaintCallbacks}.
   */
  pagePaintCallbacks?: PagePaintCallback[];
  /**
   * Builds DOM overlays laid over each page. The returned elements are placed in
   * a per-page layer that is translated and scaled to follow the page, so they
   * pan and zoom together with it. Position the elements in **page-point coordinates**
   * (origin at the page's top-left, one unit = one PDF point at zoom 1); the
   * viewer applies the zoom scale. See {@link PageOverlaysBuilder}.
   *
   * The overlay layer is click-through by default; give an element
   * `pointerEvents: 'auto'` to make it interactive. Built lazily per visible
   * page — cheap for large documents. Call {@link PdfrxViewer.refreshOverlays}
   * to rebuild after external state changes.
   */
  pageOverlaysBuilder?: PageOverlaysBuilder;
  /**
   * Resolver for fonts the PDF does not embed. Defaults to the Google Fonts
   * resolver (downloads from fonts.gstatic.com); pass `null` to disable.
   *
   * @see [Missing-font fallback](https://github.com/espresso3389/pdfrx_web/blob/master/docs/FONT-FALLBACK.md)
   *   — how the default resolver picks substitutes, and how to customize it.
   */
  fontResolver?: FontResolver | null;
  /**
   * Called when the user taps/clicks a link. When provided, it **replaces** the
   * built-in behavior (open external URLs with `window.open`, navigate internal
   * destinations with {@link PdfrxViewer.goToDest}). Use
   * {@link PdfLink.url} / {@link PdfLink.dest} to decide, and call
   * {@link PdfrxViewer.goToDest} / `window.open` yourself to keep parts of the
   * default. Omit it to keep the built-in behavior.
   */
  onLinkTap?: LinkTapHandler;
  /**
   * Replaces the built-in right-click / long-press context menu (which offers
   * Copy and Select All in English). Return a menu element the viewer will
   * position and dismiss, or `null`/`undefined` for no menu. This is the hook
   * for localizing or fully customizing the menu — the viewer itself carries no
   * translation machinery. See {@link ContextMenuBuilder}.
   */
  contextMenuBuilder?: ContextMenuBuilder;
  /**
   * Default animation duration in milliseconds for navigation and zoom
   * (`goToPage`, `goToDest`, `fitTo*`, `setZoom`, `zoomUp`/`zoomDown`,
   * `zoomToggle`). `0` (the default) means jump instantly. Each of those methods
   * also takes a per-call `duration` that overrides this.
   */
  animationDuration?: number;
  /**
   * Multiplicative step between zoom stops for {@link PdfrxViewer.zoomUp} /
   * {@link PdfrxViewer.zoomDown} (and ctrl/cmd +/-). Stops are `factor^k`, so
   * repeated up/down lands on the same grid. Default: `√2`.
   */
  zoomStepFactor?: number;
  /**
   * How far {@link PdfrxViewer.zoomToggle} (and double-tap, when enabled) zooms
   * in, as a multiple of the fit-page scale. Default: `3`.
   */
  doubleTapZoomFactor?: number;
  /**
   * Enables touch **double-tap** to zoom in/out at the tapped point (animated
   * with {@link animationDuration} or a 250 ms default). On by default.
   */
  doubleTapToZoom?: boolean;
  /**
   * Make a **mouse double-click** zoom (via {@link PdfrxViewer.zoomToggle})
   * instead of selecting the word under the cursor. Off by default (double-click
   * selects a word, the common text-viewer behavior).
   */
  doubleClickToZoom?: boolean;
  /** Enables drag-to-pan (background drag / touch drag). Default: `true`. */
  panEnabled?: boolean;
  /**
   * Restricts drag-panning to one axis. `'free'` (default) pans in both;
   * `'horizontal'` / `'vertical'` lock to that axis; `'aligned'` locks each pan
   * gesture to whichever axis it starts moving along. Wheel/keyboard scrolling
   * and programmatic navigation are unaffected.
   */
  panAxis?: PanAxis;
  /** Enables gesture zoom (pinch and ctrl/cmd + wheel). Programmatic zoom is
   * unaffected. Default: `true`. */
  zoomEnabled?: boolean;
  /** Enables mouse-wheel / trackpad scrolling. Default: `true`. */
  scrollByMouseWheel?: boolean;
  /** Enables arrow-key / Page/Home/End scrolling. Default: `true`. */
  scrollByArrowKey?: boolean;
  /**
   * Overlays native HTML controls over AcroForm fields so the user can fill the
   * form (text inputs, checkboxes, radios, dropdowns). Edits are written back to
   * the PDF and reflected by `PdfDocument.encodePdf`. Default: `true`.
   */
  interactiveForms?: boolean;
  /**
   * Paints page annotations (ink, shapes, text markup, notes) through an SVG
   * overlay instead of the canvas, and enables in-viewer annotation editing via
   * {@link PdfrxViewer.setAnnotationTool}. While on, the canvas renders form
   * widgets but not annotations (they come from the overlay), so per-edit updates
   * never re-render the page — no flicker. Edits are written back to the PDF and
   * reflected by `PdfDocument.encodePdf`. Default: `true`.
   */
  interactiveAnnotations?: boolean;
  /**
   * Extra scrollable margin, in document units, added around the document so it
   * can be panned past its edges. Default: `0` (edges are hard boundaries).
   */
  boundaryMargin?: number;
  /**
   * Called when a gesture (pan/pinch/select/handle-drag) begins. Pair with
   * {@link onInteractionEnd} to e.g. pause other work while the user interacts.
   */
  onInteractionStart?: () => void;
  /** Called when the current gesture ends and the viewer returns to idle. */
  onInteractionEnd?: () => void;
  /**
   * Called once a document has loaded and the viewer is laid out and ready to
   * interact with (after the initial fit). Fires again whenever a new document
   * is opened.
   */
  onViewerReady?: () => void;
  /**
   * Called when the viewport size changes (element resize), with the new size in
   * CSS pixels. Not called for the initial layout.
   */
  onViewSizeChanged?: (viewSize: Size) => void;
  /**
   * Called for discrete pointer gestures — single tap, double-tap, long-press,
   * and secondary (right/two-finger) tap — with the type and view-space point.
   * Fires in addition to the viewer's own handling (selection, links, zoom).
   */
  onGeneralTap?: (event: PdfViewerTapEvent) => void;
  /**
   * Builds DOM overlays fixed to the **viewport** (they do not pan or zoom with
   * the pages) — for scroll thumbs, floating toolbars, page badges, etc. The
   * layer sits above the canvas and is click-through unless a child sets
   * `pointerEvents: 'auto'`. Rebuilt on resize and document change; call
   * {@link PdfrxViewer.refreshViewerOverlays} to rebuild on demand.
   */
  viewerOverlayBuilder?: ViewerOverlayBuilder;
  /**
   * Paint a spinner (and a progress bar, when the byte count is known) while a
   * document is opening, instead of leaving the previous one on screen. Set to
   * `false` to draw your own from {@link PdfrxViewer.isLoading} /
   * {@link PdfrxViewer.addLoadingChangeListener} — the previous document is
   * hidden either way. Default: `true`.
   */
  loadingIndicator?: boolean;
  /** Color of the built-in loading indicator. Default: `'rgba(255, 255, 255, 0.85)'`. */
  loadingIndicatorColor?: string;
}

/** Progress of the document being opened (see {@link PdfrxViewer.loadingProgress}). */
export interface PdfLoadingProgress {
  /** Bytes received so far. */
  bytesReceived: number;
  /** Total bytes, or `null` when the source did not report a length. */
  bytesTotal: number | null;
}

/**
 * Constrains drag-panning to an axis (see {@link PdfrxViewerOptions.panAxis}).
 * `'aligned'` locks each gesture to the axis it first moves along.
 */
export type PanAxis = 'free' | 'horizontal' | 'vertical' | 'aligned';

/** The kind of discrete tap reported to {@link PdfrxViewerOptions.onGeneralTap}. */
export type PdfViewerTapType = 'tap' | 'doubleTap' | 'longPress' | 'secondaryTap';

/** A discrete pointer gesture (see {@link PdfrxViewerOptions.onGeneralTap}). */
export interface PdfViewerTapEvent {
  /** Which gesture occurred. */
  readonly type: PdfViewerTapType;
  /** View-space point (CSS pixels relative to the canvas top-left). */
  readonly viewPoint: Offset;
}

/**
 * Builds viewport-fixed DOM overlays (see
 * {@link PdfrxViewerOptions.viewerOverlayBuilder}). Return one element, an array,
 * or `null`/`undefined` for none. Position elements in view-space (CSS pixels).
 */
export type ViewerOverlayBuilder = (info: { viewSize: Size }) => HTMLElement | HTMLElement[] | null | undefined;

/**
 * Handles a link activation (see {@link PdfrxViewerOptions.onLinkTap}). Receives
 * the tapped {@link PdfLink}; return value is ignored.
 */
export type LinkTapHandler = (link: PdfLink) => void;

/** What a {@link ContextMenuBuilder} is given when the context menu is requested. */
export interface ContextMenuContext {
  /** Where the menu was requested, view-space CSS pixels from the canvas top-left. */
  readonly viewPoint: Offset;
  /** Whether there is a non-empty text selection (for enabling a Copy item). */
  readonly hasSelection: boolean;
  /** Whether the document permits copying ({@link PdfrxViewer.isCopyAllowed}). */
  readonly isCopyAllowed: boolean;
  /** What triggered the menu (`'mouse'`, `'touch'`, `'pen'`), for sizing hit targets. */
  readonly pointerType: string;
  /** Dismisses the menu — call it from your item handlers. */
  readonly close: () => void;
}

/**
 * Builds the context menu shown on right-click / long-press (see
 * {@link PdfrxViewerOptions.contextMenuBuilder}). Return a positioned-by-the-viewer
 * element, or `null`/`undefined` to show no menu. Build items that call
 * {@link PdfrxViewer.copySelection} / {@link PdfrxViewer.selectAll} etc. and then
 * {@link ContextMenuContext.close}. Supplying this replaces the built-in menu
 * entirely — the mechanism through which an app localizes or customizes it.
 */
export type ContextMenuBuilder = (context: ContextMenuContext) => HTMLElement | null | undefined;

/**
 * How a page is scaled to fit the viewport.
 *
 * - `'page'` — fit the entire page (both width and height are contained).
 * - `'width'` — the page width fills the viewport width.
 * - `'height'` — the page height fills the viewport height.
 */
export type FitMode = 'page' | 'width' | 'height';

/**
 * Drop shadow drawn behind each page. All
 * lengths are in CSS pixels and are **not** scaled by zoom, so the shadow keeps
 * a constant on-screen appearance.
 */
export interface PageDropShadow {
  /** Shadow color. Default: `'rgba(0, 0, 0, 0.5)'`. */
  color?: string;
  /** Gaussian blur radius in CSS pixels. Default: `4`. */
  blur?: number;
  /** Horizontal offset in CSS pixels. Default: `2`. */
  offsetX?: number;
  /** Vertical offset in CSS pixels. Default: `2`. */
  offsetY?: number;
}

/** Border stroked around each page. Lengths are in CSS pixels (zoom-independent). */
export interface PageBorder {
  /** Stroke color. Default: `'rgba(0, 0, 0, 0.3)'`. */
  color?: string;
  /** Stroke width in CSS pixels. Default: `1`. */
  width?: number;
}

/**
 * A custom page painter. The canvas is already transformed to **document
 * coordinates** (the same space as `pageRect`), and the current scale factor is
 * `devicePixelRatio * zoom`. Save/restore the context yourself if you change
 * its state.
 *
 * @param ctx - The 2D context, transformed to document space.
 * @param pageRect - The page's rectangle in document coordinates.
 * @param page - The {@link PdfPage} being painted (for size, rotation, number).
 */
export type PagePaintCallback = (ctx: CanvasRenderingContext2D, pageRect: Rect, page: PdfPage) => void;

/** Information passed to a {@link PageOverlaysBuilder} for one page. */
export interface PageOverlayInfo {
  /** 1-based page number. */
  pageNumber: number;
  /** The {@link PdfPage} (size, rotation, number). */
  page: PdfPage;
  /**
   * The overlay coordinate space: the page size in PDF points. Position overlay
   * elements within `[0, width] × [0, height]` (top-left origin); the viewer
   * scales the whole layer by the current zoom.
   */
  pageSize: Size;
}

/**
 * Builds DOM overlays for a page (see {@link PdfrxViewerOptions.pageOverlaysBuilder}).
 * Return one element, an array of elements, or `null`/`undefined` for none. The
 * elements are positioned in page-point coordinates and follow the page as it
 * pans and zooms.
 */
export type PageOverlaysBuilder = (info: PageOverlayInfo) => HTMLElement | HTMLElement[] | null | undefined;

/** Page-layout direction (see {@link PdfrxViewerOptions.layoutDirection}). */
export type LayoutDirection = 'vertical' | 'horizontal';

/**
 * A custom page-layout function (see {@link PdfrxViewerOptions.layoutPages}).
 * Given the page geometries and the resolved margin, it returns a
 * {@link PageLayout}: each page's rect in document coordinates (y-down) and the
 * total document size. `@pdfrx/viewer-core` exports `layoutPagesVertical` /
 * `layoutPagesHorizontal` as ready-made implementations and building blocks.
 */
export type LayoutPagesFn = (pages: readonly PageGeometry[], options: { margin: number }) => PageLayout;

/**
 * One end of a text selection: a page and a character index into that page's
 * text (`fullText`). Both selection ends are inclusive.
 */
export interface PdfTextSelectionPoint {
  /** 1-based page number. */
  readonly pageNumber: number;
  /** Character index into the page's `fullText`. */
  readonly index: number;
}

/**
 * The selection's two endpoints, ordered so `start` precedes `end` in reading
 * order. This is the cheap, always-available selection **state** — it carries
 * no text and touches no page geometry. Resolve the actual text and rectangles
 * on demand via {@link PdfTextSelection.getSelectedTextRanges} /
 * {@link PdfTextSelection.getSelectedText}.
 */
export interface PdfTextSelectionRange {
  readonly start: PdfTextSelectionPoint;
  readonly end: PdfTextSelectionPoint;
}

/** A resolved per-page selection range with its text and geometry. */
export interface PdfSelectedTextRange {
  /** 1-based page number this range belongs to. */
  readonly pageNumber: number;
  /** Inclusive start index into the page's `fullText`. */
  readonly start: number;
  /** Exclusive end index into the page's `fullText`. */
  readonly end: number;
  /** The range's text. */
  readonly text: string;
  /**
   * Bounding rectangle over the whole range, in **PDF page coordinates**
   * (points, origin bottom-left, y-up).
   */
  readonly bounds: PdfRect;
  /** One bounding rectangle per character in the range, in PDF page coordinates. */
  readonly charRects: readonly PdfRect[];
}

/**
 * A snapshot of the text-selection **state**, delivered to
 * {@link PdfrxViewer.addSelectionChangeListener} listeners and returned by
 * {@link PdfrxViewer.selection}.
 *
 * Following pdfrx, this object holds only the selection endpoints
 * ({@link range}); it does **not** eagerly compute the selected text.
 * Resolving text and per-page geometry — which can be comparatively expensive
 * and may need to load the text of pages between the endpoints — is deferred to
 * the explicit async {@link getSelectedText} / {@link getSelectedTextRanges}
 * methods.
 */
export interface PdfTextSelection {
  /** True when nothing is selected. */
  readonly isEmpty: boolean;
  /**
   * The selection endpoints (`start` precedes `end`), or `null` when
   * {@link isEmpty}. Cheap: derived from internal state without touching page
   * text.
   */
  readonly range: PdfTextSelectionRange | null;
  /**
   * Resolves the selection into per-page ranges with text and geometry (each
   * range's {@link PdfSelectedTextRange.bounds | bounds} give the selected
   * text's location in PDF page coordinates). Loads the text of fully-covered
   * intermediate pages as needed, hence async. Returns `[]` when {@link isEmpty}.
   */
  getSelectedTextRanges(): Promise<PdfSelectedTextRange[]>;
  /**
   * Resolves the full selected text across pages in reading order (empty string
   * when {@link isEmpty}). See {@link getSelectedTextRanges} for why it is async.
   */
  getSelectedText(): Promise<string>;
}

/**
 * Called whenever the text selection changes (see
 * {@link PdfrxViewer.addSelectionChangeListener}). Fires when the selected
 * range changes and when it is cleared; it does not fire while a drag hovers
 * over the same character. The passed {@link PdfTextSelection} is a snapshot of
 * the state at that moment.
 */
export type SelectionChangeListener = (selection: PdfTextSelection) => void;

/**
 * The result of hit-testing a view-space point against the laid-out pages
 * (see {@link PdfrxViewer.getPageHitTestResult}).
 */
export interface PdfPageHitTestResult {
  /** 1-based number of the page under the point. */
  readonly pageNumber: number;
  /** The {@link PdfPage} under the point. */
  readonly page: PdfPage;
  /**
   * The hit location in **PDF page coordinates** (points, origin bottom-left,
   * y-up), relative to the page.
   */
  readonly pdfPoint: PdfPoint;
}

/**
 * Called when the current page changes (see
 * {@link PdfrxViewer.addPageChangeListener}). The argument is the new 1-based
 * current page number, or `null` when no document is shown.
 */
export type PageChangeListener = (pageNumber: number | null) => void;

type InteractionMode =
  | { kind: 'none' }
  | {
      kind: 'pan';
      pointerId: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      startedAt: number;
      /** For `panAxis: 'aligned'`: the axis this gesture locked onto once it moved. */
      lockAxis?: 'x' | 'y';
    }
  | { kind: 'select'; pointerId: number; moved: boolean }
  | { kind: 'dragHandle'; pointerId: number; part: 'a' | 'b'; pointerType: string }
  | {
      kind: 'pinch';
      pointers: [number, number];
      startDistance: number;
      startZoom: number;
      /** Document point held fixed under the pinch midpoint. */
      startDocCenter: Offset;
    };

/**
 * One page's form-control overlay: a point-space container (transformed to
 * follow the page) plus a per-field reconciler that refreshes a control's
 * displayed value in place when the underlying field changes.
 */
interface FormPageOverlay {
  container: HTMLDivElement;
  /** Field name → update the control's displayed value from a fresh field. */
  controls: Map<string, (field: PdfFormField) => void>;
}

/**
 * One page's annotation overlay: a point-space `<svg>` (transformed to follow
 * the page) that paints the page's annotations and hosts editing.
 */
interface AnnotationPageOverlay {
  pageNumber: number;
  pageGeom: PageGeometry;
  pageSize: Size;
  container: HTMLDivElement;
  svg: SVGSVGElement;
  /** Sibling page layer whose whole transformed surface blends with the PDF canvas. */
  highlightContainer: HTMLDivElement;
  highlightSvg: SVGSVGElement;
  /** A `<g>` above the shapes holding the selected annotation's drag anchors. */
  anchorLayer: SVGGElement;
  /** Annotations currently painted, keyed by id (for hit-testing / reconcile). */
  annotations: Map<string, PdfAnnotationObject>;
}

/** A draggable control point of an annotation (endpoint / vertex / corner). */
interface AnnotationAnchor {
  /** Current position in bounding-box-relative PDF page coordinates. */
  point: PdfAnnotationPoint;
  /** Produces the full updated spec when this anchor is dragged to `to`. */
  reshape: (to: PdfAnnotationPoint) => PdfAnnotationSpec;
}

/**
 * An entry on the annotation undo/redo stack. `before`/`after` are the full
 * annotation spec in each state, or `null` for "does not exist". Applying a
 * state = remove (null) or create/replace by id (spec), which uniformly covers
 * create / delete / edit.
 */
interface AnnotationCommand {
  pageNumber: number;
  id: string;
  before: PdfAnnotationSpec | null;
  after: PdfAnnotationSpec | null;
}

/** One chronological undo/redo entry shared by annotations and page edits. */
type HistoryEntry =
  | { kind: 'annotations'; commands: AnnotationCommand[] }
  | { kind: 'pages'; before: readonly PdfPage[]; after: readonly PdfPage[] };

/** One object stored in the viewer-local annotation clipboard. */
interface AnnotationClipboardEntry {
  pageNumber: number;
  spec: PdfAnnotationSpec;
}

/** State used by Ctrl/Cmd+D after a modifier-drag duplication. */
interface AnnotationDuplicateRepeat {
  entries: AnnotationClipboardEntry[];
  selectedIds: string[];
  dx: number;
  dy: number;
}

/** An annotation editing tool selected via {@link PdfrxViewer.setAnnotationTool}. */
export type AnnotationTool = 'ink' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'highlight' | 'note' | 'freeText';

/** Current annotation interaction mode. `null` is normal text-selection viewing. */
export type AnnotationMode = AnnotationTool | 'select' | null;

/** Style applied to newly drawn annotations. */
export interface AnnotationStyle {
  /** Stroke (outline) CSS color string (e.g. `#e53935`). */
  color: string;
  /** Interior (fill) CSS color for closed shapes (rectangle/ellipse), or `null` for no fill. */
  fillColor: string | null;
  /** Stroke width in PDF points. */
  strokeWidth: number;
  /** Stroke opacity 0-1 (baked into the stroke color's alpha). */
  opacity: number;
}

/** In-progress annotation drawing gesture (page-local px). */
interface DrawState {
  pageNumber: number;
  tool: AnnotationTool;
  pageGeom: PageGeometry;
  pageSize: Size;
  svg: SVGSVGElement;
  /** Sampled points in page-local px (ink) or `[start]` for shapes. */
  points: Offset[];
  preview: SVGElement;
  pointerId: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** On-screen diameter (px) of an annotation drag anchor, held constant across zoom. */
const ANCHOR_SCREEN_PX = 8;
/** Touch handles need a finger-sized hit target while remaining visually compact. */
const TOUCH_ANCHOR_SCREEN_PX = 24;

/** `x,y` for an SVG points list. */
function offsetPair(o: Offset): string {
  return `${o.x},${o.y}`;
}

/** Bounding {@link PdfRect} of PDF-space points (y-up). */
function bboxOfPoints(pts: readonly PdfPoint[]): PdfRect {
  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const p of pts) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.max(top, p.y);
    bottom = Math.min(bottom, p.y);
  }
  return { left, top, right, bottom };
}

/** Ink strokes approximating an arrow from `s` to `e` (a shaft plus a V head). */
function arrowInkStrokes(s: PdfPoint, e: PdfPoint): PdfPoint[][] {
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(12, len * 0.3);
  const a = 0.5; // half-angle spread
  const left: PdfPoint = { x: e.x - head * (ux * Math.cos(a) - uy * Math.sin(a)), y: e.y - head * (uy * Math.cos(a) + ux * Math.sin(a)) };
  const right: PdfPoint = { x: e.x - head * (ux * Math.cos(a) + uy * Math.sin(a)), y: e.y - head * (uy * Math.cos(a) - ux * Math.sin(a)) };
  return [
    [s, e],
    [left, e, right],
  ];
}

/** Returns a detached copy of a spec, translated by (dx, dy) in PDF points. */
function translateSpec(spec: PdfAnnotationSpec, dx: number, dy: number): PdfAnnotationSpec {
  const tp = (p: PdfPoint): PdfPoint => ({ x: p.x + dx, y: p.y + dy });
  const translated = structuredClone(spec);
  if (spec.rect) {
    translated.rect = {
      left: spec.rect.left + dx,
      top: spec.rect.top + dy,
      right: spec.rect.right + dx,
      bottom: spec.rect.bottom + dy,
    };
  }
  const g = spec.geometry;
  if (!g) return translated;
  switch (g.kind) {
    case 'ink':
      translated.geometry = { kind: 'ink', strokes: g.strokes.map((st) => st.map(tp)) };
      break;
    case 'markup':
      translated.geometry = {
        kind: 'markup',
        quads: g.quads.map((q) => ({ topLeft: tp(q.topLeft), topRight: tp(q.topRight), bottomLeft: tp(q.bottomLeft), bottomRight: tp(q.bottomRight) })),
      };
      break;
    case 'line':
      translated.geometry = { kind: 'line', start: tp(g.start), end: tp(g.end) };
      break;
    case 'polygon':
    case 'polyline':
      translated.geometry = { kind: g.kind, vertices: g.vertices.map(tp) };
      break;
  }
  return translated;
}

/** Builds a spec from an existing annotation, translated by (dx, dy) in PDF points. */
function translateAnnotationSpec(a: PdfAnnotationObject, dx: number, dy: number): PdfAnnotationSpec {
  return translateSpec(
    {
      subtype: a.subtype,
      rect: a.rect,
      color: a.color,
      interiorColor: a.interiorColor,
      borderWidth: a.borderWidth,
      flags: a.flags,
      contents: a.contents,
    author: a.author,
    fontFace: a.fontFace,
    appearanceLines: a.appearanceLines ? [...a.appearanceLines] : undefined,
    appearanceRuns: a.appearanceRuns?.map((line) => line.map((run) => ({ ...run }))),
      geometry: a.geometry,
    },
    dx,
    dy,
  );
}

/** The full spec of an existing annotation (unchanged geometry). */
function annotationToSpec(a: PdfAnnotationObject): PdfAnnotationSpec {
  return translateAnnotationSpec(a, 0, 0);
}

/** Bounding {@link PdfRect} of every ink point in a spec (y-up). */
function inkSpecRect(strokes: PdfAnnotationPoint[][]): PdfRect {
  return bboxOfPoints(strokes.flat());
}

/**
 * A displayable annotation object built by overlaying a spec's rect/color/
 * geometry onto a base annotation — used to live-render a drag preview.
 */
function syntheticAnnotation(base: PdfAnnotationObject, spec: PdfAnnotationSpec): PdfAnnotationObject {
  return {
    ...base,
    rect: spec.rect ?? base.rect,
    color: spec.color === undefined ? base.color : spec.color,
    interiorColor: spec.interiorColor === undefined ? base.interiorColor : spec.interiorColor,
    borderWidth: spec.borderWidth ?? base.borderWidth,
    flags: spec.flags ?? base.flags,
    contents: spec.contents === undefined ? base.contents : spec.contents,
    author: spec.author === undefined ? base.author : spec.author,
    geometry: spec.geometry ?? base.geometry,
  };
}

/** Union (bounding) {@link PdfRect} of several boxes (y-up). */
function unionBounds(rects: readonly PdfRect[]): PdfRect {
  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left, r.right);
    right = Math.max(right, r.left, r.right);
    top = Math.max(top, r.top, r.bottom);
    bottom = Math.min(bottom, r.top, r.bottom);
  }
  return { left, top, right, bottom };
}

/** Whether two y-down px rectangles overlap (edges inclusive). */
function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/** The eight bounding-box handle points (corners + edge midpoints), fixed order. */
function boundingBoxHandlePoints(b: PdfRect): PdfAnnotationPoint[] {
  const midX = (b.left + b.right) / 2;
  const midY = (b.top + b.bottom) / 2;
  return [
    { x: b.left, y: b.top },
    { x: midX, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: midY },
    { x: b.right, y: b.bottom },
    { x: midX, y: b.bottom },
    { x: b.left, y: b.bottom },
    { x: b.left, y: midY },
  ];
}

/** Applies a bounding-box handle drag (by index) to `box`, returning the new box (normalized). */
function resizeBoxByHandle(box: PdfRect, index: number, to: PdfAnnotationPoint): PdfRect {
  const edges = [
    { left: true, top: true },
    { top: true },
    { right: true, top: true },
    { right: true },
    { right: true, bottom: true },
    { bottom: true },
    { left: true, bottom: true },
    { left: true },
  ][index] as { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
  let { left, right, top, bottom } = box;
  if (edges.left) left = to.x;
  if (edges.right) right = to.x;
  if (edges.top) top = to.y;
  if (edges.bottom) bottom = to.y;
  const nb: PdfRect = { left: Math.min(left, right), right: Math.max(left, right), top: Math.max(top, bottom), bottom: Math.min(top, bottom) };
  if (nb.right - nb.left < 1) nb.right = nb.left + 1;
  if (nb.top - nb.bottom < 1) nb.top = nb.bottom + 1;
  return nb;
}

/** Bounding {@link PdfRect} (y-up) of an annotation's geometry. */
function annotationBounds(a: PdfAnnotationObject): PdfRect {
  const g = a.geometry;
  switch (g.kind) {
    case 'ink':
      return inkSpecRect(g.strokes);
    case 'markup':
      return bboxOfPoints(g.quads.flatMap((q) => [q.topLeft, q.topRight, q.bottomLeft, q.bottomRight]));
    case 'line':
      return bboxOfPoints([g.start, g.end]);
    case 'polygon':
    case 'polyline':
      return g.vertices.length ? bboxOfPoints(g.vertices) : a.rect;
    default:
      return a.rect;
  }
}

/** Maps a spec's geometry + rect from `oldBox` to `newBox` by an affine scale (y-up). */
function scaleAnnotationSpec(a: PdfAnnotationObject, oldBox: PdfRect, newBox: PdfRect): PdfAnnotationSpec {
  const ow = oldBox.right - oldBox.left || 1;
  const oh = oldBox.top - oldBox.bottom || 1;
  const sx = (newBox.right - newBox.left) / ow;
  const sy = (newBox.top - newBox.bottom) / oh;
  const map = (p: PdfAnnotationPoint): PdfAnnotationPoint => ({
    x: newBox.left + (p.x - oldBox.left) * sx,
    y: newBox.bottom + (p.y - oldBox.bottom) * sy,
  });
  const s = annotationToSpec(a);
  // Map the annotation's own rect through the transform (not to `newBox`), so a
  // group scale repositions/resizes each member within the group instead of
  // collapsing them all onto the group box. For a single-shape resize `oldBox`
  // is the shape's own bounds, so this still yields `newBox`.
  const c1 = map({ x: a.rect.left, y: a.rect.top });
  const c2 = map({ x: a.rect.right, y: a.rect.bottom });
  s.rect = { left: Math.min(c1.x, c2.x), right: Math.max(c1.x, c2.x), top: Math.max(c1.y, c2.y), bottom: Math.min(c1.y, c2.y) };
  const g = a.geometry;
  if (g.kind === 'ink') s.geometry = { kind: 'ink', strokes: g.strokes.map((st) => st.map(map)) };
  else if (g.kind === 'markup')
    s.geometry = {
      kind: 'markup',
      quads: g.quads.map((q) => ({ topLeft: map(q.topLeft), topRight: map(q.topRight), bottomLeft: map(q.bottomLeft), bottomRight: map(q.bottomRight) })),
    };
  else if (g.kind === 'line') s.geometry = { kind: 'line', start: map(g.start), end: map(g.end) };
  else if (g.kind === 'polygon' || g.kind === 'polyline') s.geometry = { kind: g.kind, vertices: g.vertices.map(map) };
  return s;
}

/**
 * The eight bounding-box handles (corners + edge midpoints) that scale a shape.
 * A handle may cross the opposite edge freely (the box is normalized, not
 * ordering-locked); a 1pt floor just avoids a degenerate box.
 */
function boundingBoxAnchors(a: PdfAnnotationObject): AnnotationAnchor[] {
  const b = annotationBounds(a);
  return boundingBoxHandlePoints(b).map((point, index) => ({
    point,
    reshape: (to) => scaleAnnotationSpec(a, b, resizeBoxByHandle(b, index, to)),
  }));
}

/** Classifies an ink annotation by how it was authored (from its stroke shape). */
function inkStrokeKind(g: { strokes: PdfAnnotationPoint[][] }): 'line' | 'arrow' | 'curve' {
  if (g.strokes.length > 1) return 'arrow'; // arrow = shaft stroke + head stroke(s)
  const s0 = g.strokes[0];
  if (!s0 || s0.length <= 2) return 'line'; // a straight 2-point stroke
  return 'curve'; // freehand pen
}

/** Whether a selected annotation shows the faint bounding-box guide. */
function annotationShowsBoundingBox(a: PdfAnnotationObject): boolean {
  if (a.subtype === 'circle') return true; // ellipse
  // A fill-only rectangle has no visible outline of its own, so retain the
  // same dashed selection guide used for ellipses.
  if (a.subtype === 'square' && (a.borderWidth <= 0 || a.color === null)) return true;
  if (a.geometry.kind === 'ink') return inkStrokeKind(a.geometry) === 'curve'; // freehand pen
  return false; // stroked rectangle, line/arrow, markup, free text, …
}

/**
 * The draggable control points of an annotation:
 * - straight lines & arrows (authored as 2-point / multi-stroke ink) and true
 *   `line` annotations expose just their two endpoints;
 * - polygons/polylines keep per-vertex handles;
 * - freehand pen, rectangle, ellipse and other area shapes expose the eight
 *   bounding-box handles and drag = uniform scale.
 */
function annotationAnchors(a: PdfAnnotationObject): AnnotationAnchor[] {
  // A Text annotation is a fixed-size note icon. Its associated popup/editor
  // may be resized independently, but scaling the icon itself is not meaningful.
  if (a.subtype === 'text') return [];
  const base = annotationToSpec(a);
  const clone = (): PdfAnnotationSpec => structuredClone(base);
  const g = a.geometry;
  switch (g.kind) {
    case 'line':
      return (['start', 'end'] as const).map((end) => ({
        point: g[end],
        reshape: (to) => {
          const s = clone();
          (s.geometry as { kind: 'line'; start: PdfAnnotationPoint; end: PdfAnnotationPoint })[end] = { x: to.x, y: to.y };
          return s;
        },
      }));
    case 'polygon':
    case 'polyline':
      return g.vertices.map((p, vi) => ({
        point: p,
        reshape: (to) => {
          const s = clone();
          (s.geometry as { kind: 'polygon' | 'polyline'; vertices: PdfAnnotationPoint[] }).vertices[vi] = { x: to.x, y: to.y };
          return s;
        },
      }));
    case 'ink': {
      const kind = inkStrokeKind(g);
      if (kind === 'line') {
        // Straight line: two draggable endpoints.
        return [0, 1].map((pi) => ({
          point: g.strokes[0]![pi]!,
          reshape: (to) => {
            const s = clone();
            const strokes = (s.geometry as { kind: 'ink'; strokes: PdfAnnotationPoint[][] }).strokes;
            strokes[0]![pi] = { x: to.x, y: to.y };
            s.rect = inkSpecRect(strokes);
            return s;
          },
        }));
      }
      if (kind === 'arrow') {
        // Arrow: endpoints of the shaft; the head regenerates from them.
        const shaft = g.strokes[0]!;
        const ends = [shaft[0]!, shaft[shaft.length - 1]!];
        return ends.map((pt, i) => ({
          point: pt,
          reshape: (to) => {
            const start = i === 0 ? { x: to.x, y: to.y } : ends[0]!;
            const end = i === 1 ? { x: to.x, y: to.y } : ends[1]!;
            const s = clone();
            const strokes = arrowInkStrokes(start, end);
            s.geometry = { kind: 'ink', strokes };
            s.rect = inkSpecRect(strokes);
            return s;
          },
        }));
      }
      return boundingBoxAnchors(a); // freehand pen
    }
    default:
      // rect-defined (square, circle, freeText, text, …) and markup: scale.
      return boundingBoxAnchors(a);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** An annotation RGB color as a CSS string, or `fallback` when unset. */
function colorCss(c: { r: number; g: number; b: number; a: number } | null, fallback: string): string;
function colorCss(c: { r: number; g: number; b: number; a: number } | null, fallback: null): string | null;
function colorCss(c: { r: number; g: number; b: number; a: number } | null, fallback: string | null): string | null {
  if (!c) return fallback;
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/** Parses `#rrggbb` (or `#rgb`) to an RGBA color (alpha from `opacity` 0-1). */
function cssColorToRgba(css: string, opacity = 1): { r: number; g: number; b: number; a: number } {
  let hex = css.trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return { r, g, b, a: Math.round(Math.max(0, Math.min(1, opacity)) * 255) };
}

type FreeTextFontKind = number | 'symbols';
type FreeTextRunKind = FreeTextFontKind | 'latin' | 'neutral';

/** Selects the fallback font family needed by one grapheme cluster. */
function freeTextRunKind(text: string): FreeTextRunKind {
  if (/\p{Extended_Pictographic}|[\u2000-\u2bff\ufe0f]/u.test(text)) return 'symbols';
  // Prefer the more specific scripts before the shared Han ideograph range.
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 128;
  if (/\p{Script=Hangul}/u.test(text)) return 129;
  if (/\p{Script=Han}/u.test(text)) return 134;
  if (/\p{Script=Arabic}/u.test(text)) return 178;
  if (/\p{Script=Hebrew}/u.test(text)) return 177;
  if (/\p{Script=Thai}/u.test(text)) return 222;
  if (/\p{Script=Cyrillic}/u.test(text)) return 204;
  if (/\p{Script=Greek}/u.test(text)) return 161;
  if (/\p{Script=Latin}|[\u0000-\u00ff]/u.test(text)) return 'latin';
  if (/\p{Script=Common}|\p{Script=Inherited}/u.test(text)) return 'neutral';
  return 1;
}

const FREE_TEXT_FONT_SIZE = 12;
const FREE_TEXT_PADDING = 3;
/** Minimum on-screen box created by a click or very short FreeText drag. */
const FREE_TEXT_MIN_SCREEN_WIDTH = 120;
const FREE_TEXT_MIN_SCREEN_HEIGHT = 48;
/** Minimum on-screen dimensions for click/short-drag geometry tools. */
const SHAPE_MIN_SCREEN_SIZE = 72;
const LINE_MIN_SCREEN_LENGTH = 96;

/** Expands a y-down drag rectangle to a minimum size and keeps it inside the page. */
function minimumDrawRect(a: Offset, b: Offset, minWidth: number, minHeight: number, bounds: Size): Rect {
  let left = Math.min(a.x, b.x);
  let right = Math.max(a.x, b.x);
  let top = Math.min(a.y, b.y);
  let bottom = Math.max(a.y, b.y);
  if (right - left < minWidth) {
    if (b.x < a.x) left = a.x - minWidth;
    else right = a.x + minWidth;
  }
  if (bottom - top < minHeight) {
    if (b.y < a.y) top = a.y - minHeight;
    else bottom = a.y + minHeight;
  }
  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right > bounds.width) {
    left -= right - bounds.width;
    right = bounds.width;
  }
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (bottom > bounds.height) {
    top -= bottom - bounds.height;
    bottom = bounds.height;
  }
  return { left, top, right, bottom };
}

/** Extends a short line in its drag direction and shifts it wholly inside the page. */
function minimumDrawLine(a: Offset, b: Offset, minLength: number, bounds: Size): [Offset, Offset] {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < minLength) {
    if (length < 0.01) {
      dx = a.x + minLength <= bounds.width ? minLength : -minLength;
      dy = 0;
    } else {
      const scale = minLength / length;
      dx *= scale;
      dy *= scale;
    }
  }
  let start = { ...a };
  let end = { x: a.x + dx, y: a.y + dy };
  const shiftX = Math.min(0, bounds.width - Math.max(start.x, end.x)) - Math.min(0, Math.min(start.x, end.x));
  const shiftY = Math.min(0, bounds.height - Math.max(start.y, end.y)) - Math.min(0, Math.min(start.y, end.y));
  start = { x: start.x + shiftX, y: start.y + shiftY };
  end = { x: end.x + shiftX, y: end.y + shiftY };
  return [start, end];
}

function renderFreeTextEmoji(text: string): { width: number; height: number; scale: number; pixels: Uint8Array } | undefined {
  const scale = 3;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) return undefined;
  measure.font = `${FREE_TEXT_FONT_SIZE}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  const logicalWidth = Math.max(FREE_TEXT_FONT_SIZE, Math.ceil(measure.measureText(text).width + 2));
  const logicalHeight = Math.ceil(FREE_TEXT_FONT_SIZE * 1.35);
  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.scale(scale, scale);
  context.font = `${FREE_TEXT_FONT_SIZE}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  context.textBaseline = 'top';
  context.fillText(text, 1, 0);
  return {
    width: canvas.width,
    height: canvas.height,
    scale,
    pixels: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data),
  };
}

/** Wraps explicit paragraphs and long lines using the same 12pt UI font. */
function wrapFreeText(text: string, width: number, fontSize = FREE_TEXT_FONT_SIZE): string[] {
  const maxWidth = Math.max(1, width - FREE_TEXT_PADDING * 2);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return text.replace(/\r\n?/g, '\n').split('\n');
  context.font = `${fontSize}px Arial, sans-serif`;
  const result: string[] = [];
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const fits = (value: string): boolean => context.measureText(value).width <= maxWidth;
  const pushBrokenToken = (prefix: string, token: string): string => {
    let line = prefix;
    for (const char of token) {
      if (line && !fits(line + char)) {
        result.push(line.trimEnd());
        line = char;
      } else {
        line += char;
      }
    }
    return line;
  };
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph === '') {
      result.push('');
      continue;
    }
    const tokens = segmenter ? [...segmenter.segment(paragraph)].map((item) => item.segment) : paragraph.split(/(\s+)/u);
    let line = '';
    for (const token of tokens) {
      if (fits(line + token)) {
        line += token;
      } else if (line) {
        result.push(line.trimEnd());
        line = fits(token) ? token.trimStart() : pushBrokenToken('', token.trimStart());
      } else {
        line = pushBrokenToken('', token);
      }
    }
    result.push(line.trimEnd());
  }
  return result.length ? result : [''];
}

function refreshFreeTextLayout(spec: PdfAnnotationSpec): void {
  if (spec.subtype !== 'freeText' || !spec.rect || spec.contents == null) return;
  spec.appearanceLines = wrapFreeText(
    spec.contents,
    spec.rect.right - spec.rect.left - (spec.borderWidth ?? 0) * 2,
  );
  spec.appearanceRuns = undefined;
}

const HANDLE_HIT_RADIUS = 24;
const TAP_SLOP = 4;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;

/**
 * Canvas-based PDF viewer: renders pages to a `<canvas>` and drives panning,
 * zoom, text selection, links, search, and printing.
 *
 * Constructs a `<canvas>` inside the given container, opens a document with
 * {@link openUrl} / {@link openData}, and drives rendering, panning, pinch
 * zoom, text selection, links, search, and printing. All geometry and selection
 * logic lives in `@pdfrx/viewer-core`; this class owns the DOM canvas, the
 * pointer state machine, and the render loop. Text selection is painted on the
 * canvas — there is deliberately no DOM text layer.
 *
 * Always call {@link dispose} when done; if the viewer created its own engine,
 * disposal also tears down the rendering worker.
 *
 * @example
 * ```ts
 * const viewer = new PdfrxViewer(document.getElementById('host')!, {
 *   engineOptions: { wasmModulesUrl: 'pdfium/' }, // must contain pdfium_worker.js + pdfium.wasm
 * });
 * await viewer.openUrl('doc.pdf'); // fetched with CORS
 * viewer.goToPage(3);
 *
 * const searcher = viewer.createTextSearcher();
 * searcher.startTextSearch('invoice');
 * // ...later
 * viewer.dispose();
 * ```
 */
export class PdfrxViewer {
  /**
   * @param container - Host element the canvas is appended to; it is made
   *   `position: relative` if statically positioned so overlays (context menu)
   *   can anchor to it. Size the viewer by sizing this element.
   * @param options - See {@link PdfrxViewerOptions}.
   */
  constructor(container: HTMLElement, options: PdfrxViewerOptions = {}) {
    this.container = container;
    this.options = options;
    this.#engine = options.engine ?? new PdfrxEngine(options.engineOptions ?? { wasmModulesUrl: 'pdfium/' });
    this.ownsEngine = !options.engine;
    this.layoutDirectionValue = options.layoutDirection ?? 'vertical';

    if (!container.style.position && getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // DOM overlay layer above the canvas: holds per-page overlay containers
    // that are transformed to follow each page (see pageOverlaysBuilder). It is
    // click-through by default (pointer-events: none) so viewer gestures still
    // reach the canvas; individual overlays opt in with pointer-events: auto.
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.appendChild(this.overlayRoot);

    // Form-field overlay layer: native HTML controls positioned over AcroForm
    // widgets. Same click-through container as overlayRoot; the controls
    // themselves opt into pointer-events so they capture their own input.
    this.formOverlayRoot = document.createElement('div');
    this.formOverlayRoot.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.appendChild(this.formOverlayRoot);

    // Annotation overlay layer: per-page SVG that paints the document's
    // annotations (ink, shapes, markup, notes) and hosts interactive editing.
    // Click-through unless a drawing tool is active or a shape opts in, so
    // viewer gestures still reach the canvas.
    this.annotationOverlayRoot = document.createElement('div');
    this.annotationOverlayRoot.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.appendChild(this.annotationOverlayRoot);

    // Viewport-fixed overlay layer (does not pan/zoom); above the page overlays.
    this.viewerOverlayRoot = document.createElement('div');
    this.viewerOverlayRoot.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.appendChild(this.viewerOverlayRoot);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    // Listen on the shared host rather than only the canvas. Annotation select
    // and drawing modes put an interactive SVG above the canvas; wheel events
    // originating there bubble to the host but can never reach the sibling
    // canvas beneath it.
    this.container.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private readonly container: HTMLElement;
  private readonly options: PdfrxViewerOptions;
  readonly #engine: PdfrxEngine;
  private readonly ownsEngine: boolean;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlayRoot: HTMLDivElement;
  private readonly formOverlayRoot: HTMLDivElement;
  private readonly annotationOverlayRoot: HTMLDivElement;
  private readonly viewerOverlayRoot: HTMLDivElement;
  /** Per-page overlay containers, built lazily when a page first becomes visible. */
  private readonly overlayContainers = new Map<number, HTMLElement>();
  /** Per-page form-control overlays (native HTML controls over AcroForm widgets). */
  private readonly formOverlays = new Map<number, FormPageOverlay>();
  /** Per-page annotation overlays (SVG painting the page's annotations). */
  private readonly annotationOverlays = new Map<number, AnnotationPageOverlay>();
  /** Per-page loaded annotations, keyed by page number (mirrors {@link pageFormFields}). */
  private readonly pageAnnotations = new Map<number, PdfAnnotationObject[] | Promise<PdfAnnotationObject[]>>();
  /** Pages whose current SVG stays visible until freshly loaded data can replace it atomically. */
  private readonly dirtyAnnotationOverlayPages = new Set<number>();
  /** Invalidates annotation loads that were started before a document edit. */
  private annotationReloadGeneration = 0;
  /** Last known objects by id; survives the brief gap while SVG overlays rebuild. */
  private readonly annotationSnapshots = new Map<string, { pageNumber: number; annotation: PdfAnnotationObject }>();
  /**
   * Active annotation mode: a drawing tool, `'select'` (marquee/multi-select
   * editing), or null (normal viewing — pan/text-select, single-click select).
   */
  private annotationMode: AnnotationMode = null;
  /** Current style applied to newly drawn annotations. */
  private annotationStyle: AnnotationStyle = {
    color: '#e53935',
    fillColor: null,
    strokeWidth: 3,
    opacity: 1,
  };
  /** Ids of the currently selected annotations (empty when none). */
  private readonly selectedAnnotationIds = new Set<string>();
  /** Viewer-local clipboard; avoids browser clipboard permission prompts for structured objects. */
  private annotationClipboard: AnnotationClipboardEntry[] = [];
  /** Number of times the current clipboard contents have been pasted. */
  private annotationClipboardPasteCount = 0;
  /** Cut pastes at the original position once; copies start with an offset. */
  private annotationClipboardWasCut = false;
  /** Serializes paste requests so rapid shortcuts cannot interleave history groups. */
  private annotationPasteQueue: Promise<void> = Promise.resolve();
  /** Last modifier-drag result, repeated at the same displacement by Ctrl/Cmd+D. */
  private annotationDuplicateRepeat: AnnotationDuplicateRepeat | null = null;
  /** Serializes modifier-drag commits and rapid Ctrl/Cmd+D repeats. */
  private annotationDuplicateQueue: Promise<void> = Promise.resolve();
  /** In-progress drawing gesture, or null. */
  private drawState: DrawState | null = null;
  /** Chronological annotation and page-edit history. Entries before the index are applied. */
  private history: HistoryEntry[] = [];
  private historyIndex = 0;
  private readonly historyChangeListeners = new Set<() => void>();
  /** Merge key attached to the latest history entry (used by slider gestures). */
  private annotationHistoryMergeKey: string | null = null;
  /** Keeps annotation style writes single-flight. */
  private annotationStyleUpdateQueue: Promise<void> = Promise.resolve();
  /** Includes an active Text/FreeText editor and the worker write it starts. */
  private pendingAnnotationTextEdit: Promise<void> = Promise.resolve();
  /** Latest queued generation per slider gesture; older waiting writes are skipped. */
  private readonly annotationStyleLatestGeneration = new Map<string, number>();
  /** True while a pointer gesture is in progress (for onInteractionStart/End). */
  private interactionActive = false;
  private readonly resizeObserver: ResizeObserver;

  private doc: PdfDocument | null = null;
  private pageGeoms: PageGeometry[] = [];
  private layout: PageLayout | null = null;
  private layoutDirectionValue: LayoutDirection;
  private cache: PageRenderCache | null = null;
  private readonly pageTexts = new Map<number, PdfPageText | Promise<PdfPageText>>();
  private readonly pageLinks = new Map<number, PdfLink[] | Promise<PdfLink[]>>();
  /** Cached form fields per page position (parallel to {@link pageLinks}); feeds the form overlay. */
  private readonly pageFormFields = new Map<number, PdfFormField[] | Promise<PdfFormField[]>>();
  /**
   * Bumped whenever page positions stop meaning what they meant (new document,
   * rearrangement). Text and links are cached by position, so a load that was
   * in flight across the change must not write its result back.
   */
  private arrangementGeneration = 0;
  private hoveredLink: { link: PdfLink; rects: Rect[] } | null = null;

  private viewSize: Size = { width: 0, height: 0 };
  private transform: ViewTransform = { zoom: 1, xZoomed: 0, yZoomed: 0 };
  private get maxZoom(): number {
    return this.options.maxZoom ?? 8;
  }
  /**
   * Effective minimum zoom. If {@link PdfrxViewerOptions.minZoom} is set, that
   * value is used. Otherwise it is the smaller of
   * {@link coverScale} (fit the whole document's bounding box) and the current
   * page's {@link fitPageScale} (fit one whole page), computed dynamically from
   * the current page so you can never zoom out past seeing a whole page.
   */
  private get minZoom(): number {
    if (this.options.minZoom !== undefined) return this.options.minZoom;
    if (!this.layout || this.viewSize.width <= 0 || this.viewSize.height <= 0) return 0.1;
    const cover = this.coverScale;
    const fitPage = this.pageFitScale(this.currentPageNumber ?? 1);
    return fitPage == null ? cover : Math.min(cover, fitPage);
  }

  private mode: InteractionMode = { kind: 'none' };
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPointerType = 'mouse';
  private menuEl: HTMLElement | null = null;
  private pendingMenuOnUp = false;
  private searcher: PdfTextSearcher | null = null;
  private currentSource:
    | { kind: 'url'; url: string | URL; options: PdfOpenUrlOptions }
    | { kind: 'data'; data: Uint8Array | ArrayBuffer; options: PdfOpenOptions }
    | null = null;
  /** Non-zero while a document is opening; a counter so overlapping opens nest. */
  private loadingCount = 0;
  private loadingProgressValue: PdfLoadingProgress | null = null;
  private readonly loadingChangeListeners = new Set<() => void>();
  private readonly documentChangeListeners = new Set<() => void>();
  private readonly selectionChangeListeners = new Set<SelectionChangeListener>();
  private readonly pageChangeListeners = new Set<PageChangeListener>();
  private readonly transformChangeListeners = new Set<() => void>();
  private readonly annotationModeChangeListeners = new Set<(mode: AnnotationMode) => void>();
  /** Signature of the last-notified selection, so we don't fire on no-op updates. */
  private lastSelectionSig = 'empty';
  /** Last current-page value notified to {@link pageChangeListeners}. */
  private lastNotifiedPage: number | null = null;
  /** Last transform notified to {@link transformChangeListeners}. */
  private lastNotifiedTransform: ViewTransform | null = null;

  private selA: SelectionPoint | null = null;
  private selB: SelectionPoint | null = null;
  private anchors: SelectionAnchors | null = null;
  /** Show draggable handles (touch-driven selections). */
  private showHandles = false;

  private rafId: number | null = null;
  private paintTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /** In-flight transform animation (navigation/zoom tween), or null. */
  private anim: {
    from: ViewTransform;
    to: ViewTransform;
    startTime: number;
    duration: number;
    handle: number | ReturnType<typeof setTimeout>;
    hidden: boolean;
  } | null = null;
  /** Last completed tap (for touch double-tap detection). */
  private lastTap: { time: number; x: number; y: number } | null = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Opens a document by URL and displays it, replacing any current document.
   *
   * The engine fetches the file, so the URL must be same-origin or CORS-enabled
   * (relative URLs resolve against `document.baseURI`). The source is retained
   * so the viewer can transparently reopen it after registering missing-font
   * fallbacks. For password-protected PDFs, supply a provider via `options`.
   */
  async openUrl(url: string | URL, options: PdfOpenUrlOptions = {}): Promise<void> {
    return await this.whileLoading(async () => {
      // Report download progress without stealing the caller's callback.
      const caller = options.progressCallback;
      const doc = await this.#engine.openUrl(url, {
        ...options,
        progressCallback: (bytesReceived, bytesTotal) => {
          // bytesTotal is omitted when the response had no Content-Length.
          this.setLoadingProgress({ bytesReceived, bytesTotal: bytesTotal ? bytesTotal : null });
          caller?.(bytesReceived, bytesTotal);
        },
      });
      this.currentSource = { kind: 'url', url, options };
      await this.setDocument(doc);
    });
  }

  /**
   * Opens a document from in-memory bytes and displays it, replacing any current
   * document. The source is retained for the missing-font reopen (see
   * {@link openUrl}).
   */
  async openData(data: Uint8Array | ArrayBuffer, options: PdfOpenOptions = {}): Promise<void> {
    return await this.whileLoading(async () => {
      const doc = await this.#engine.openData(data, options);
      this.currentSource = { kind: 'data', data, options };
      await this.setDocument(doc);
    });
  }

  /**
   * Whether a document is currently opening. While this is true the previous
   * document is not painted — parsing a large PDF takes seconds, and leaving
   * the old one on screen makes the viewer look stuck.
   */
  get isLoading(): boolean {
    return this.loadingCount > 0;
  }

  /**
   * Download progress of the document being opened, or `null` when nothing is
   * loading or the source reports no byte counts (e.g. {@link openData}).
   */
  get loadingProgress(): PdfLoadingProgress | null {
    return this.loadingProgressValue;
  }

  /**
   * Registers a listener called when {@link isLoading} or
   * {@link loadingProgress} changes — for a custom loading UI, or to disable
   * controls while a document opens.
   *
   * @returns An unsubscribe function.
   */
  addLoadingChangeListener(listener: () => void): () => void {
    this.loadingChangeListeners.add(listener);
    return () => this.loadingChangeListeners.delete(listener);
  }

  /**
   * @internal
   * Marks the viewer as loading for the duration of `open`, hiding the previous
   * document and dropping its queued renders so the worker is free to parse.
   */
  private async whileLoading(open: () => Promise<void>): Promise<void> {
    this.loadingCount++;
    if (this.loadingCount === 1) {
      // Renders for the document being replaced would otherwise sit ahead of
      // the new document's work in the queue.
      this.cache?.cancelAllPending();
      this.loadingProgressValue = null;
      this.notifyLoadingChanged();
    }
    this.invalidate();
    try {
      await open();
    } finally {
      this.loadingCount--;
      if (this.loadingCount === 0) {
        this.loadingProgressValue = null;
        this.notifyLoadingChanged();
      }
      this.invalidate();
    }
  }

  private setLoadingProgress(progress: PdfLoadingProgress): void {
    if (this.loadingCount === 0) return;
    this.loadingProgressValue = progress;
    this.notifyLoadingChanged();
    this.invalidate();
  }

  private notifyLoadingChanged(): void {
    for (const listener of this.loadingChangeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in loading change listener:', e);
      }
    }
  }

  /**
   * Registers a listener called whenever the shown document changes —
   * including the automatic reopen after missing-font registration.
   *
   * @returns An unsubscribe function.
   */
  addDocumentChangeListener(listener: () => void): () => void {
    this.documentChangeListeners.add(listener);
    return () => this.documentChangeListeners.delete(listener);
  }

  /**
   * Registers a listener called whenever the text selection changes — as the
   * user drags to select, when a word/all is selected programmatically, and when
   * the selection is cleared. The listener receives a {@link PdfTextSelection}
   * snapshot; you can also pull the current state via {@link selection} at any
   * time.
   *
   * The listener is not called for no-op updates (e.g. a drag that stays over
   * the same character).
   *
   * @returns An unsubscribe function.
   */
  addSelectionChangeListener(listener: SelectionChangeListener): () => void {
    this.selectionChangeListeners.add(listener);
    return () => this.selectionChangeListeners.delete(listener);
  }

  /**
   * Registers a listener called whenever the {@link currentPageNumber} changes —
   * as the user scrolls/zooms and on document load (fires with the new 1-based
   * page number, or `null` when no document is shown). The listener is
   * deduplicated: it fires only when the value actually changes.
   *
   * @returns An unsubscribe function.
   */
  addPageChangeListener(listener: PageChangeListener): () => void {
    this.pageChangeListeners.add(listener);
    return () => this.pageChangeListeners.delete(listener);
  }

  /**
   * Registers a listener called whenever the view transform changes — every pan,
   * zoom, fit, resize and animation frame that actually moves the view. The
   * listener takes no argument; pull the new state from {@link currentTransform}
   * or {@link zoom}.
   *
   * Like {@link addPageChangeListener} this is driven from the paint loop and is
   * deduplicated, so it fires at most once per frame and never for a no-op.
   *
   * @returns An unsubscribe function.
   */
  addTransformChangeListener(listener: () => void): () => void {
    this.transformChangeListeners.add(listener);
    return () => this.transformChangeListeners.delete(listener);
  }

  /** A snapshot of the current text selection. */
  get selection(): PdfTextSelection {
    return this.buildSelection();
  }

  /**
   * Converts a **view-space** point (CSS pixels relative to the viewer canvas's
   * top-left) to **document space** (the unzoomed coordinate space of the whole
   * laid-out document).
   */
  viewToDocumentPoint(viewPoint: Offset): Offset {
    return viewToDocument(this.transform, viewPoint);
  }

  /**
   * Converts a **document-space** point to a **view-space** point (CSS pixels
   * relative to the viewer canvas's top-left). Inverse of
   * {@link viewToDocumentPoint}.
   */
  documentToViewPoint(docPoint: Offset): Offset {
    return documentToView(this.transform, docPoint);
  }

  /**
   * Hit-tests a **view-space** point (CSS pixels relative to the canvas, e.g.
   * from `event.offsetX/Y`) against the laid-out pages.
   *
   * @returns The page under the point and the hit location in PDF page
   *   coordinates, or `null` if the point is not over any page (in the margin or
   *   background).
   */
  getPageHitTestResult(viewPoint: Offset): PdfPageHitTestResult | null {
    if (!this.layout || !this.doc) return null;
    const docPoint = viewToDocument(this.transform, viewPoint);
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectContains(pageRect, docPoint)) continue;
      const page = this.doc.pages[i];
      const geom = this.pageGeoms[i];
      if (!page || !geom) return null;
      return { pageNumber: i + 1, page, pdfPoint: offsetToPdfPointInDocument(docPoint, geom, pageRect) };
    }
    return null;
  }

  /** The currently open {@link PdfDocument}, or `null` before the first open. */
  get document(): PdfDocument | null {
    return this.doc;
  }

  /**
   * The engine backing this viewer. Use it to open other documents in the *same*
   * worker — e.g. to convert an image to a PDF, or to import pages from a dropped
   * file into {@link document} (cross-document page import only works within one
   * engine). Shared if an {@link PdfrxViewerOptions.engine} was supplied.
   */
  get engine(): PdfrxEngine {
    return this.#engine;
  }

  /** Number of pages in the current document, or `0` when none is open. */
  get pageCount(): number {
    return this.doc?.pages.length ?? 0;
  }

  /**
   * The current view transform (uniform zoom + pan). Document→view mapping used
   * throughout the viewer.
   */
  get currentTransform(): ViewTransform {
    return this.transform;
  }

  /** The current page-layout direction. See {@link setLayoutDirection}. */
  get layoutDirection(): LayoutDirection {
    return this.layoutDirectionValue;
  }

  /**
   * Switches the page-layout direction at runtime, re-laying out the document
   * and refitting the view. No-op if unchanged or if a custom
   * {@link PdfrxViewerOptions.layoutPages} is in effect (which always wins).
   */
  setLayoutDirection(direction: LayoutDirection): void {
    if (direction === this.layoutDirectionValue || this.options.layoutPages) return;
    this.layoutDirectionValue = direction;
    if (!this.doc) return;
    this.layout = this.computeLayout();
    this.resetView();
  }

  /**
   * The plain text of the current selection (empty string when nothing is
   * selected). Only pages whose text has already loaded contribute; text is
   * composed across pages in reading order.
   */
  get selectedText(): string {
    if (!this.selA || !this.selB) return '';
    return composeSelectedText(
      getSelectedRanges(this.selA, this.selB, (n) => {
        const t = this.pageTexts.get(n);
        return t instanceof Promise ? null : (t ?? null);
      }),
    );
  }

  /** Clears the current text selection, hides its handles, and repaints. */
  clearSelection(): void {
    this.selA = this.selB = null;
    this.anchors = null;
    this.showHandles = false;
    this.hideContextMenu();
    this.notifySelectionChanged();
    this.invalidate();
  }

  /** Select all text of all pages (loads page texts as needed). */
  async selectAll(): Promise<void> {
    if (!this.doc) return;
    for (let n = 1; n <= this.doc.pages.length; n++) this.ensureText(n);
    await Promise.all([...this.pageTexts.values()].map((t) => (t instanceof Promise ? t : Promise.resolve(t))));
    const texts: PdfPageText[] = [];
    for (let n = 1; n <= this.doc.pages.length; n++) {
      const t = this.getLoadedText(n);
      if (t && t.charRects.length > 0) texts.push(t);
    }
    if (texts.length === 0) return;
    const last = texts[texts.length - 1]!;
    this.selA = { text: texts[0]!, index: 0 };
    this.selB = { text: last, index: last.charRects.length - 1 };
    this.showHandles = this.lastPointerType === 'touch';
    this.updateAnchors();
  }

  /**
   * Sets (or restores) the text selection from a {@link PdfTextSelectionRange} —
   * the same shape carried by {@link selection}`.range`, so you can save that
   * value and pass it back here later. Both endpoint indices are **inclusive**.
   * Pass `null` to clear the selection (equivalent to {@link clearSelection}).
   *
   * Loads the endpoint pages' text as needed (hence async). Indices are clamped
   * to each page's character range. Returns `true` if a selection was set, or
   * `false` if it could not be (e.g. no document, or the endpoint pages have no
   * selectable text).
   */
  async setTextSelection(range: PdfTextSelectionRange | null): Promise<boolean> {
    if (!range) {
      this.clearSelection();
      return false;
    }
    if (!this.doc) return false;
    const a = await this.selectionPointFor(range.start);
    const b = await this.selectionPointFor(range.end);
    if (!a || !b) return false;
    this.selA = a;
    this.selB = b;
    this.showHandles = this.lastPointerType === 'touch';
    this.updateAnchors();
    return true;
  }

  /** @internal Resolves an endpoint (page + index) to an internal selection point. */
  private async selectionPointFor(p: PdfTextSelectionPoint): Promise<SelectionPoint | null> {
    const text = await this.loadTextAsync(p.pageNumber);
    if (!text || text.charRects.length === 0) return null;
    const index = Math.max(0, Math.min(p.index, text.charRects.length - 1));
    return { text, index };
  }

  /**
   * Selects the word at a **view-space** point (CSS pixels relative to the
   * canvas), like a double-click. The point's page text must already be loaded
   * (it is for visible pages). Returns `true` if a word was selected.
   */
  selectWordAtPoint(viewPoint: Offset): boolean {
    const word = selectWordAt(viewToDocument(this.transform, viewPoint), this.selectablePages());
    if (!word) return false;
    this.selA = word.selA;
    this.selB = word.selB;
    this.showHandles = this.lastPointerType === 'touch';
    this.updateAnchors();
    return true;
  }

  /**
   * Whether copying the document's text is permitted. Mirrors pdfrx: a document
   * with no encryption/permissions allows copying, and an encrypted document
   * allows it unless its permissions explicitly forbid it
   * ({@link PdfPermissions.allowsCopying} is `false`).
   */
  get isCopyAllowed(): boolean {
    return this.doc?.permissions?.allowsCopying !== false;
  }

  /**
   * Copies the current selection to the system clipboard.
   *
   * Works in non-secure contexts too (a phone hitting a dev server by its LAN
   * IP over plain HTTP has no `navigator.clipboard`); see
   * {@link writeTextToClipboard}.
   *
   * @returns `true` if there was text to copy (and the write was attempted),
   *   `false` if the selection was empty or the document forbids copying.
   */
  async copySelection(): Promise<boolean> {
    if (!this.isCopyAllowed) return false;
    const text = this.selectedText;
    if (!text) return false;
    await writeTextToClipboard(text);
    return true;
  }

  /**
   * Fit the given page (1-based) into the view — alias of {@link fitToPage}.
   *
   * @param duration - Animation duration in ms (defaults to
   *   {@link PdfrxViewerOptions.animationDuration}); `0` jumps instantly.
   */
  goToPage(pageNumber: number, duration?: number): void {
    this.fitToPage(pageNumber, duration);
  }

  /** The current zoom factor (`1` = 72 DPI, one PDF point per CSS pixel). */
  get zoom(): number {
    return this.transform.zoom;
  }

  /**
   * The **cover scale**: the zoom at which the whole
   * document's bounding box covers the viewport, i.e. `max(viewW / docW,
   * viewH / docH)`. In the default vertical layout this is effectively the
   * fit-document-width scale — you cannot zoom out past it and still fill the
   * viewport horizontally. Returns `1` before a document is laid out.
   */
  get coverScale(): number {
    if (!this.layout || this.viewSize.width <= 0 || this.viewSize.height <= 0) return 1;
    return Math.max(
      this.viewSize.width / this.layout.documentSize.width,
      this.viewSize.height / this.layout.documentSize.height,
    );
  }

  /**
   * The **fit-page scale**: the zoom at which an
   * entire page fits within the viewport, `min(viewW / pageW, viewH / pageH)`
   * (page size includes the {@link PdfrxViewerOptions.margin}). Defaults to the
   * current page. Returns `null` before a document is laid out or if the page
   * number is out of range.
   *
   * The effective minimum zoom is `min(coverScale, fitPageScale)`.
   */
  fitPageScale(pageNumber?: number): number | null {
    return this.pageFitScale(pageNumber ?? this.currentPageNumber ?? 1);
  }

  /** @internal Fit-page scale for a specific page (1-based), or null if out of range. */
  private pageFitScale(pageNumber: number): number | null {
    if (!this.layout || this.viewSize.width <= 0 || this.viewSize.height <= 0) return null;
    const pr = this.layout.pageLayouts[pageNumber - 1];
    if (!pr) return null;
    const m2 = this.margin * 2;
    const scale = Math.min(
      this.viewSize.width / (rectWidth(pr) + m2),
      this.viewSize.height / (rectHeight(pr) + m2),
    );
    return scale > 0 ? scale : null;
  }

  /** @internal Computes the transform that fits a page into the view per mode. */
  private fitTransform(pageNumber: number, mode: FitMode): ViewTransform | null {
    if (!this.layout || this.viewSize.width <= 0 || this.viewSize.height <= 0) return null;
    const pr = this.layout.pageLayouts[pageNumber - 1];
    if (!pr) return null;
    const inflated = rectInflate(pr, this.margin);
    const w = rectWidth(inflated);
    const h = rectHeight(inflated);
    const clampZoom = (z: number): number => Math.min(Math.max(z, this.minZoom), this.maxZoom);
    const center = rectCenter(inflated);
    switch (mode) {
      case 'page': {
        const zoom = clampZoom(Math.min(this.viewSize.width / w, this.viewSize.height / h));
        return calcTransformFor(center, zoom, this.viewSize);
      }
      case 'width': {
        const zoom = clampZoom(this.viewSize.width / w);
        // Fill width, aligning the top of the page to the top of the viewport.
        return calcTransformFor({ x: center.x, y: inflated.top + this.viewSize.height / 2 / zoom }, zoom, this.viewSize);
      }
      case 'height': {
        const zoom = clampZoom(this.viewSize.height / h);
        return calcTransformFor(center, zoom, this.viewSize);
      }
    }
  }

  /**
   * Fit an entire page within the viewport (both width and height contained).
   * Defaults to the current page. This is the "Fit Page" action.
   *
   * @param duration - Animation duration in ms (defaults to
   *   {@link PdfrxViewerOptions.animationDuration}); `0` jumps instantly.
   */
  fitToPage(pageNumber?: number, duration?: number): void {
    const t = this.fitTransform(pageNumber ?? this.currentPageNumber ?? 1, 'page');
    if (t) this.navigateTo(t, duration ?? this.defaultAnimationDuration);
  }

  /**
   * Scale a page so its width fills the viewport, aligning the top of the page
   * to the top of the viewport. Defaults to the current page. This is the
   * "Fit Width" action (a common default for continuous reading).
   */
  fitToWidth(pageNumber?: number, duration?: number): void {
    const t = this.fitTransform(pageNumber ?? this.currentPageNumber ?? 1, 'width');
    if (t) this.navigateTo(t, duration ?? this.defaultAnimationDuration);
  }

  /**
   * Scale a page so its height fills the viewport, centered horizontally.
   * Defaults to the current page. This is the "Fit Height" action.
   */
  fitToHeight(pageNumber?: number, duration?: number): void {
    const t = this.fitTransform(pageNumber ?? this.currentPageNumber ?? 1, 'height');
    if (t) this.navigateTo(t, duration ?? this.defaultAnimationDuration);
  }

  /** The page (1-based) currently covering the largest visible area, or null. */
  get currentPageNumber(): number | null {
    if (!this.layout) return null;
    const visible = calcVisibleRect(this.transform, this.viewSize);
    let best: number | null = null;
    let bestArea = 0;
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const r = rectIntersect(this.layout.pageLayouts[i]!, visible);
      if (rectIsEmpty(r)) continue;
      const area = rectWidth(r) * rectHeight(r);
      if (area > bestArea) {
        bestArea = area;
        best = i + 1;
      }
    }
    return best;
  }

  /**
   * Navigate to a PDF explicit destination. Falls back to `goToPage` for
   * unknown/short-hand destinations.
   *
   * @param duration - Animation duration in ms (defaults to
   *   {@link PdfrxViewerOptions.animationDuration}); `0` jumps instantly.
   */
  goToDest(dest: PdfDest | null, duration?: number): void {
    if (!dest) return;
    const t = this.calcTransformForDest(dest);
    if (t) this.navigateTo(t, duration ?? this.defaultAnimationDuration);
    else this.goToPage(dest.pageNumber, duration);
  }

  /** @internal Computes the transform for a destination command (xyz, fit variants, fitR). */
  private calcTransformForDest(dest: PdfDest): ViewTransform | null {
    if (!this.layout) return null;
    const page = this.pageGeoms[dest.pageNumber - 1];
    const pageRect = this.layout.pageLayouts[dest.pageNumber - 1];
    if (!page || !pageRect) return null;
    const calcX = (x: number | null | undefined): number => ((x ?? 0) / page.width) * rectWidth(pageRect);
    const calcY = (y: number | null | undefined): number => ((page.height - (y ?? 0)) / page.height) * rectHeight(pageRect);
    const params = dest.params;
    const cur = this.transform;
    switch (dest.command) {
      case 'xyz': {
        if (params.length >= 2) {
          const zoom = params.length >= 3 && params[2] != null && params[2] !== 0 ? params[2] : cur.zoom;
          const hw = this.viewSize.width / 2 / zoom;
          const hh = this.viewSize.height / 2 / zoom;
          return calcTransformFor(
            { x: pageRect.left + calcX(params[0]) + hw, y: pageRect.top + calcY(params[1]) + hh },
            zoom,
            this.viewSize,
          );
        }
        break;
      }
      case 'fit':
      case 'fitB':
        return calcTransformForRect(rectInflate(pageRect, this.margin), this.viewSize, { zoomMax: this.maxZoom });
      case 'fitH':
      case 'fitBH': {
        if (params.length >= 1) {
          const hh = this.viewSize.height / 2 / cur.zoom;
          return calcTransformFor(
            { x: pageRect.left, y: pageRect.top + calcY(params[0]) + hh },
            cur.zoom,
            this.viewSize,
          );
        }
        break;
      }
      case 'fitV':
      case 'fitBV': {
        if (params.length >= 1) {
          const hw = this.viewSize.width / 2 / cur.zoom;
          return calcTransformFor(
            { x: pageRect.left + calcX(params[0]) + hw, y: pageRect.top },
            cur.zoom,
            this.viewSize,
          );
        }
        break;
      }
      case 'fitR': {
        if (params.length === 4) {
          // page /FitR left bottom right top
          const rect: Rect = {
            left: pageRect.left + calcX(params[0]),
            top: pageRect.top + calcY(params[3]),
            right: pageRect.left + calcX(params[2]),
            bottom: pageRect.top + calcY(params[1]),
          };
          return calcTransformForRect(rect, this.viewSize);
        }
        break;
      }
    }
    return null;
  }

  /**
   * Bring a rectangle (PDF page coordinates on the given page) into view,
   * keeping the current zoom. No-op when already visible.
   */
  ensureVisiblePageRect(pageNumber: number, rect: PdfRect, margin = 0): void {
    if (!this.layout) return;
    const page = this.pageGeoms[pageNumber - 1];
    const pageRect = this.layout.pageLayouts[pageNumber - 1];
    if (!page || !pageRect) return;
    const docRect = pdfRectToRectInDocument(rect, page, pageRect);
    const visible = calcVisibleRect(this.transform, this.viewSize, margin);
    if (rectContainsRect(visible, docRect)) return;
    this.setTransform(calcTransformFor(rectCenter(docRect), this.transform.zoom, this.viewSize));
  }

  /** Loads (and caches) the structured text of a page. */
  async loadPageText(pageNumber: number): Promise<PdfPageText | null> {
    this.ensureText(pageNumber);
    const t = this.pageTexts.get(pageNumber);
    if (!t) return null;
    return t instanceof Promise ? await t : t;
  }

  /** Document outline (bookmarks). */
  async loadOutline(): Promise<PdfOutlineNode[]> {
    return (await this.doc?.loadOutline()) ?? [];
  }

  /** Render a page thumbnail at the given CSS width. */
  async renderPageThumbnail(pageNumber: number, width = 120): Promise<ImageBitmap | null> {
    const page = this.doc?.pages[pageNumber - 1];
    if (!page) return null;
    const scale = (width * (window.devicePixelRatio || 1)) / page.width;
    const image = await page.render({
      fullWidth: Math.ceil(page.width * scale),
      fullHeight: Math.ceil(page.height * scale),
    });
    return image ? await image.toImageBitmap() : null;
  }

  /**
   * Creates a text searcher whose matches are highlighted by this viewer.
   * The previous searcher (if any) is disposed.
   */
  createTextSearcher(): PdfTextSearcher {
    this.searcher?.dispose();
    this.searcher = new PdfTextSearcher(this);
    return this.searcher;
  }

  /** @internal — repaint request from collaborators (e.g. the searcher). */
  invalidatePaint(): void {
    this.invalidate();
  }

  /**
   * Render all pages at the given DPI and open the browser print dialog.
   */
  async print(options: { dpi?: number } = {}): Promise<void> {
    if (!this.doc) return;
    const dpi = options.dpi ?? 150;
    const sources: string[] = [];
    const work = document.createElement('canvas');
    const workCtx = work.getContext('2d')!;
    for (const page of this.doc.pages) {
      // Cap the pixel size so huge pages don't blow the memory budget.
      const scale = Math.min(dpi / 72, Math.sqrt((8 * 1024 * 1024) / (page.width * page.height)));
      const image = await page.render({
        fullWidth: Math.ceil(page.width * scale),
        fullHeight: Math.ceil(page.height * scale),
      });
      if (!image) continue;
      work.width = image.width;
      work.height = image.height;
      workCtx.putImageData(image.toImageData(), 0, 0);
      sources.push(work.toDataURL('image/png'));
    }
    if (sources.length === 0) return;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument!;
    idoc.open();
    idoc.write(
      '<!doctype html><html><head><style>@page{margin:0}body{margin:0}' +
        'img{display:block;width:100%;page-break-after:always}</style></head><body>' +
        sources.map((src) => `<img src="${src}">`).join('') +
        '</body></html>',
    );
    idoc.close();
    await Promise.all([...idoc.images].map((img) => img.decode().catch(() => undefined)));
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    // Give the print spooler time to snapshot the document before removal.
    setTimeout(() => iframe.remove(), 60_000);
  }

  /**
   * Sets the absolute zoom, keeping a view point fixed on screen. The value is
   * clamped to `[minZoom, maxZoom]`, where the effective minimum is
   * `min(`{@link coverScale}`, `{@link fitPageScale}`)` — you can never zoom out
   * past seeing a whole page — and the maximum is
   * {@link PdfrxViewerOptions.maxZoom} (default 8). To fit a page rather than
   * pick an absolute factor, use {@link fitToPage} / {@link fitToWidth} /
   * {@link fitToHeight}.
   *
   * @param zoom - Target zoom factor (`1` = one PDF point per CSS pixel).
   * @param viewCenter - View-space point to keep stationary. Defaults to the
   *   center of the viewport.
   * @param duration - Animation duration in ms (defaults to
   *   {@link PdfrxViewerOptions.animationDuration}); `0` jumps instantly.
   */
  setZoom(zoom: number, viewCenter?: Offset, duration?: number): void {
    const center = viewCenter ?? { x: this.viewSize.width / 2, y: this.viewSize.height / 2 };
    this.zoomAt(center, zoom, duration ?? this.defaultAnimationDuration);
  }

  /**
   * Zooms **in** to the next zoom stop (`factor^k`, see
   * {@link PdfrxViewerOptions.zoomStepFactor}), keeping `viewCenter` fixed.
   */
  zoomUp(viewCenter?: Offset, duration?: number): void {
    this.setZoom(this.getNextZoom(), viewCenter, duration);
  }

  /** Zooms **out** to the previous zoom stop. See {@link zoomUp}. */
  zoomDown(viewCenter?: Offset, duration?: number): void {
    this.setZoom(this.getPreviousZoom(), viewCenter, duration);
  }

  /**
   * Toggles between the fit-page zoom and a zoomed-in level
   * ({@link PdfrxViewerOptions.doubleTapZoomFactor}× fit), centered on
   * `viewPoint`. This is what touch double-tap and (optionally) mouse
   * double-click invoke.
   */
  zoomToggle(viewPoint?: Offset, duration?: number): void {
    const fit = this.pageFitScale(this.currentPageNumber ?? 1) ?? this.transform.zoom;
    const zoomedIn = this.clampZoom(fit * (this.options.doubleTapZoomFactor ?? 3));
    const atFit = Math.abs(this.transform.zoom - fit) <= fit * 0.02;
    this.setZoom(atFit ? zoomedIn : fit, viewPoint, duration);
  }

  /** The next zoom stop above `zoom` on the `factor^k` grid, clamped. */
  getNextZoom(zoom = this.transform.zoom): number {
    const f = this.zoomStepFactor;
    const k = Math.floor(Math.log(zoom) / Math.log(f) + 1e-6) + 1;
    return this.clampZoom(Math.pow(f, k));
  }

  /** The previous zoom stop below `zoom` on the `factor^k` grid, clamped. */
  getPreviousZoom(zoom = this.transform.zoom): number {
    const f = this.zoomStepFactor;
    const k = Math.ceil(Math.log(zoom) / Math.log(f) - 1e-6) - 1;
    return this.clampZoom(Math.pow(f, k));
  }

  private get zoomStepFactor(): number {
    const f = this.options.zoomStepFactor ?? Math.SQRT2;
    return f > 1 ? f : Math.SQRT2;
  }

  private clampZoom(zoom: number): number {
    return Math.min(Math.max(zoom, this.minZoom), this.maxZoom);
  }

  private get defaultAnimationDuration(): number {
    return Math.max(0, this.options.animationDuration ?? 0);
  }

  /**
   * Tears down the viewer: cancels timers and animation frames, stops
   * auto-scroll/fling, disconnects the resize observer, disposes the searcher,
   * render cache, and document, and removes the canvas. If the viewer created
   * its own engine (no {@link PdfrxViewerOptions.engine} was passed), the
   * rendering worker is shut down too. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.paintTimer !== null) clearTimeout(this.paintTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.stopAnimation();
    this.stopAutoScroll();
    this.stopFling();
    this.resizeObserver.disconnect();
    this.hideContextMenu();
    this.searcher?.dispose();
    this.clearFormOverlays();
    this.clearAnnotationOverlays();
    this.container.removeEventListener('wheel', this.onWheel, { capture: true });
    this.cache?.dispose();
    void this.doc?.dispose();
    if (this.ownsEngine) this.#engine.dispose();
    this.overlayRoot.remove();
    this.formOverlayRoot.remove();
    this.annotationOverlayRoot.remove();
    this.viewerOverlayRoot.remove();
    this.canvas.remove();
  }

  // -------------------------------------------------------------------------
  // Document / layout
  // -------------------------------------------------------------------------

  private get margin(): number {
    return this.options.margin ?? 8;
  }

  /** Resolved page drop shadow, or null when disabled. Defaults to a soft shadow. */
  private get resolvedPageDropShadow(): Required<PageDropShadow> | null {
    const s = this.options.pageDropShadow;
    if (s === null) return null;
    return {
      color: s?.color ?? 'rgba(0, 0, 0, 0.5)',
      blur: s?.blur ?? 4,
      offsetX: s?.offsetX ?? 2,
      offsetY: s?.offsetY ?? 2,
    };
  }

  /** Resolved page border, or null when disabled (the default). */
  private get resolvedPageBorder(): Required<PageBorder> | null {
    const b = this.options.pageBorder;
    if (!b) return null;
    return { color: b.color ?? 'rgba(0, 0, 0, 0.3)', width: b.width ?? 1 };
  }

  private async setDocument(doc: PdfDocument): Promise<void> {
    this.cache?.dispose();
    await this.doc?.dispose();
    this.arrangementGeneration++;
    this.pageTexts.clear();
    this.pageFormFields.clear();
    this.clearFormOverlays();
    this.pageAnnotations.clear();
    this.annotationSnapshots.clear();
    this.clearAnnotationOverlays();
    this.overlayContainers.clear();
    this.overlayRoot.replaceChildren();
    this.clearSelection();
    this.lastNotifiedPage = null;
    this.lastNotifiedTransform = null;

    this.doc = doc;
    this.pageGeoms = doc.pages.map((p) => ({ width: p.width, height: p.height, rotation: p.rotation / 90 }));
    this.layout = this.computeLayout();
    this.cache = new PageRenderCache(doc, () => this.invalidate(), () => this.canvasAnnotationRenderingMode());
    this.pageLinks.clear();
    this.hoveredLink = null;
    this.clearHistory();
    this.selectedAnnotationIds.clear();
    doc.addEventListener('missingFonts', ({ queries }) => this.onMissingFonts(queries));
    doc.addEventListener('pageStatusChanged', () => this.onPageStatusChanged());
    doc.addEventListener('pagesRearranged', () => this.onPagesRearranged());
    doc.addEventListener('formFieldsChanged', () => this.reconcileFormOverlays());
    doc.addEventListener('annotationsChanged', () => this.onAnnotationsChanged());
    this.resetView();
    this.buildViewerOverlays();
    for (const listener of this.documentChangeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in document change listener:', e);
      }
    }
    try {
      this.options.onViewerReady?.();
    } catch (e) {
      console.error('Error in onViewerReady:', e);
    }
  }

  /**
   * Page metadata changed (progressive loading, reload). Page sizes may now be
   * known, so the layout is rebuilt; nothing else is invalidated.
   */
  private onPageStatusChanged(): void {
    if (!this.doc) return;
    this.pageGeoms = this.doc.pages.map((p) => ({ width: p.width, height: p.height, rotation: p.rotation / 90 }));
    this.layout = this.computeLayout();
    this.invalidate();
  }

  /**
   * The page arrangement changed (`PdfDocument.setPages` / `assemblePages`).
   * Anything keyed by page position is dropped; rendered page bitmaps are not,
   * because {@link PageRenderCache} keys them by content — which is what makes
   * reordering and rotating in a GUI instant.
   */
  private onPagesRearranged(): void {
    if (!this.doc) return;
    this.arrangementGeneration++;
    this.pageTexts.clear();
    this.pageLinks.clear();
    this.pageFormFields.clear();
    this.clearFormOverlays();
    this.pageAnnotations.clear();
    this.annotationSnapshots.clear();
    this.clearAnnotationOverlays();
    this.hoveredLink = null;
    this.clearSelection();
    this.cache?.onArrangementChanged();
    this.searcher?.onPagesRearranged();
    this.onPageStatusChanged();
  }

  /** Computes the page layout from the custom hook, or the direction built-ins. */
  private computeLayout(): PageLayout {
    const opts = { margin: this.margin };
    if (this.options.layoutPages) return this.options.layoutPages(this.pageGeoms, opts);
    const layout = this.layoutDirectionValue === 'horizontal' ? layoutPagesHorizontal : layoutPagesVertical;
    return layout(this.pageGeoms, opts);
  }

  private resetView(): void {
    if (!this.layout || this.viewSize.width <= 0 || this.viewSize.height <= 0) return;
    const t = this.fitTransform(1, this.options.initialFit ?? 'page');
    if (t) this.setTransform(t);
  }

  /** Applies {@link PdfrxViewerOptions.panAxis} to a raw pan delta. */
  private constrainPan(dx: number, dy: number, mode: { lockAxis?: 'x' | 'y' }): [number, number] {
    switch (this.options.panAxis ?? 'free') {
      case 'horizontal':
        return [dx, 0];
      case 'vertical':
        return [0, dy];
      case 'aligned':
        mode.lockAxis ??= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        return mode.lockAxis === 'x' ? [dx, 0] : [0, dy];
      default:
        return [dx, dy];
    }
  }

  private onResize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const changed = rect.width !== this.viewSize.width || rect.height !== this.viewSize.height;
    this.viewSize = { width: rect.width, height: rect.height };
    // Assigning canvas.width/height clears the bitmap, so only do it when the
    // backing-store size actually changes — a sub-pixel layout shift that rounds
    // to the same size must not blank the canvas.
    const canvasW = Math.max(1, Math.round(rect.width * dpr));
    const canvasH = Math.max(1, Math.round(rect.height * dpr));
    const bitmapCleared = canvasW !== this.canvas.width || canvasH !== this.canvas.height;
    if (bitmapCleared) {
      this.canvas.width = canvasW;
      this.canvas.height = canvasH;
    }
    if (this.layout && this.transform.zoom === 1 && this.transform.xZoomed === 0 && this.transform.yZoomed === 0) {
      this.resetView();
    } else {
      this.setTransform(this.transform); // re-clamp
    }
    this.buildViewerOverlays(); // viewport-fixed overlays depend on view size
    // When the bitmap was cleared, redraw in this same frame instead of waiting
    // for the scheduled paint — otherwise an animated resize (e.g. the sidebar
    // sliding open) flashes the empty canvas between the clear and the repaint.
    if (bitmapCleared) this.paintNow();
    if (changed) {
      try {
        this.options.onViewSizeChanged?.({ width: rect.width, height: rect.height });
      } catch (e) {
        console.error('Error in onViewSizeChanged:', e);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Transform
  // -------------------------------------------------------------------------

  private clamp(t: ViewTransform): ViewTransform {
    if (!this.layout) return t;
    const bm = this.options.boundaryMargin ?? 0;
    const boundary = bm > 0 ? { left: bm, top: bm, right: bm, bottom: bm } : edgeInsetsZero;
    const margins = adjustBoundaryMargins(this.viewSize, t.zoom, this.layout.documentSize, boundary);
    return clampToBoundary(t, this.viewSize, this.layout.documentSize, margins);
  }

  /** Applies a transform immediately, cancelling any in-flight animation. */
  private setTransform(t: ViewTransform): void {
    this.stopAnimation();
    this.transform = this.clamp(t);
    this.invalidate();
  }

  private zoomAt(viewPoint: Offset, newZoom: number, duration = 0): void {
    const zoom = this.clampZoom(newZoom);
    const docPoint = viewToDocument(this.transform, viewPoint);
    this.navigateTo(
      { zoom, xZoomed: viewPoint.x - docPoint.x * zoom, yZoomed: viewPoint.y - docPoint.y * zoom },
      duration,
    );
  }

  /**
   * Moves to `target`, animating over `duration` ms (or jumping when `duration`
   * <= 0). The target is boundary-clamped; intermediate frames interpolate the
   * affine transform with an ease-out curve.
   */
  private navigateTo(target: ViewTransform, duration: number): void {
    const to = this.clamp(target);
    this.stopAnimation();
    if (duration <= 0 || this.viewSize.width <= 0) {
      this.transform = to;
      this.invalidate();
      return;
    }
    const from = this.transform;
    // No visible change -> skip the animation.
    if (Math.abs(from.zoom - to.zoom) < 1e-6 && Math.abs(from.xZoomed - to.xZoomed) < 0.5 && Math.abs(from.yZoomed - to.yZoomed) < 0.5) {
      this.transform = to;
      this.invalidate();
      return;
    }
    const hidden = document.visibilityState === 'hidden';
    const startTime = performance.now();
    const step = (): void => {
      if (!this.anim) return;
      const elapsed = performance.now() - this.anim.startTime;
      const raw = Math.min(1, elapsed / this.anim.duration);
      const e = 1 - Math.pow(1 - raw, 3); // easeOutCubic
      const a = this.anim.from;
      const b = this.anim.to;
      this.transform = {
        zoom: a.zoom + (b.zoom - a.zoom) * e,
        xZoomed: a.xZoomed + (b.xZoomed - a.xZoomed) * e,
        yZoomed: a.yZoomed + (b.yZoomed - a.yZoomed) * e,
      };
      this.invalidate();
      if (raw >= 1) {
        this.transform = b;
        this.anim = null;
        this.invalidate();
      } else {
        this.anim.handle = hidden ? setTimeout(step, 16) : requestAnimationFrame(step);
      }
    };
    this.anim = { from, to, startTime, duration, handle: 0, hidden };
    this.anim.handle = hidden ? setTimeout(step, 16) : requestAnimationFrame(step);
  }

  /** Cancels any in-flight navigation/zoom animation (leaving the transform as-is). */
  private stopAnimation(): void {
    if (!this.anim) return;
    if (this.anim.hidden) clearTimeout(this.anim.handle as ReturnType<typeof setTimeout>);
    else cancelAnimationFrame(this.anim.handle as number);
    this.anim = null;
  }

  // -------------------------------------------------------------------------
  // Text loading / selection helpers
  // -------------------------------------------------------------------------

  private getLoadedText(pageNumber: number): PdfPageText | null {
    const t = this.pageTexts.get(pageNumber);
    return t instanceof Promise ? null : (t ?? null);
  }

  private ensureText(pageNumber: number): void {
    if (!this.doc || this.pageTexts.has(pageNumber)) return;
    const page = this.doc.pages[pageNumber - 1];
    if (!page || !page.isLoaded) return;
    const generation = this.arrangementGeneration;
    const promise = (async () => {
      const raw = await page.loadText();
      const text = formatText(
        raw ? { fullText: raw.fullText, charRects: [...raw.charRects] } : { fullText: '', charRects: [] },
        pageNumber,
      );
      // The pages moved while this was loading: `pageNumber` no longer refers to
      // this page, so caching the result would pin stale text to that position.
      if (generation === this.arrangementGeneration) {
        this.pageTexts.set(pageNumber, text);
        this.invalidate();
      }
      return text;
    })();
    this.pageTexts.set(pageNumber, promise);
  }

  // ---- Missing-font fallback ----

  /** Queries already processed (or failed), keyed independently of the document. */
  private readonly attemptedFontKeys = new Set<string>();
  /** Download cache so several queries resolving to the same file fetch once. */
  private readonly fontDownloads = new Map<string, Promise<Uint8Array | null>>();
  /** Registered fonts used by mixed-script FreeText appearances. */
  private readonly freeTextFonts = new Map<FreeTextFontKind, Promise<string | null>>();
  /** Serializes fallback batches so reloadFonts is not called concurrently. */
  private fontWork: Promise<void> = Promise.resolve();

  private onMissingFonts(queries: PdfFontQuery[]): void {
    const resolver = this.options.fontResolver === undefined ? googleFontsResolver : this.options.fontResolver;
    if (!resolver) return;
    const fresh = queries.filter((q) => {
      const key = `${q.face}|${q.weight}|${q.isItalic}|${q.charset}|${q.pitchFamily}`;
      if (this.attemptedFontKeys.has(key)) return false;
      this.attemptedFontKeys.add(key);
      return true;
    });
    if (fresh.length === 0) return;
    this.fontWork = this.fontWork.then(() => this.resolveMissingFonts(resolver, fresh));
  }

  private async resolveMissingFonts(resolver: FontResolver, queries: PdfFontQuery[]): Promise<void> {
    let registered = 0;
    for (const query of queries) {
      try {
        const resolution = resolver(query);
        if (!resolution) continue;
        let download = this.fontDownloads.get(resolution.url);
        if (!download) {
          download = (async (): Promise<Uint8Array | null> => {
            const response = await fetch(resolution.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
          })().catch((e) => {
            console.warn(`pdfrx: failed to download fallback font ${resolution.url}:`, e);
            return null;
          });
          this.fontDownloads.set(resolution.url, download);
        }
        const data = await download;
        if (!data) continue;
        await this.#engine.addFontData(query.face, data, resolution.resolvedFace);
        console.info(`pdfrx: font fallback "${query.face}" -> "${resolution.resolvedFace}" (${data.length} bytes)`);
        registered++;
      } catch (e) {
        console.warn('pdfrx: font fallback failed for', query, e);
      }
    }
    if (registered === 0 || this.disposed) return;

    await this.#engine.reloadFonts();
    // Refreshing the mapper is not enough: the engine caches substituted fonts
    // per document, so the document must be reopened. Preserve the view state.
    const source = this.currentSource;
    if (!source) {
      this.cache?.clearAllRendered();
      this.pageTexts.clear();
      this.invalidate();
      return;
    }
    try {
      const saved = this.transform;
      if (source.kind === 'url') {
        await this.setDocument(await this.#engine.openUrl(source.url, source.options));
      } else {
        await this.setDocument(await this.#engine.openData(source.data, source.options));
      }
      this.setTransform(saved);
    } catch (e) {
      console.error('pdfrx: failed to reload document after font registration:', e);
    }
  }

  // ---- Links ----

  private ensureLinks(pageNumber: number): void {
    if (!this.doc || this.pageLinks.has(pageNumber)) return;
    const page = this.doc.pages[pageNumber - 1];
    if (!page || !page.isLoaded) return;
    const generation = this.arrangementGeneration;
    const promise = page.loadLinks().then((links) => {
      // See ensureText: a rearrangement in flight invalidates the position key.
      if (generation === this.arrangementGeneration) {
        this.pageLinks.set(pageNumber, links);
        this.invalidate();
      }
      return links;
    });
    this.pageLinks.set(pageNumber, promise);
  }

  private getLoadedLinks(pageNumber: number): PdfLink[] | null {
    const links = this.pageLinks.get(pageNumber);
    return links instanceof Promise ? null : (links ?? null);
  }

  /** Find the link under a document position, with its rects in document coordinates. */
  private linkAt(docPoint: Offset): { link: PdfLink; rects: Rect[] } | null {
    if (!this.layout) return null;
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectContains(pageRect, docPoint)) continue;
      const links = this.getLoadedLinks(i + 1);
      if (!links) continue;
      const pageGeom = this.pageGeoms[i]!;
      for (const link of links) {
        const rects = link.rects.map((r) => pdfRectToRectInDocument(r, pageGeom, pageRect));
        if (rects.some((r) => rectContains(r, docPoint))) return { link, rects };
      }
    }
    return null;
  }

  private openLink(link: PdfLink): void {
    const handler = this.options.onLinkTap;
    if (handler) {
      try {
        handler(link);
      } catch (e) {
        console.error('Error in onLinkTap handler:', e);
      }
      return;
    }
    if (link.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } else if (link.dest) {
      this.goToDest(link.dest);
    }
  }

  // -------------------------------------------------------------------------
  // Form fields (AcroForm) — feed the HTML overlay layer (see updateFormOverlays)
  // -------------------------------------------------------------------------

  /** Loads (once) the form fields of a page position; mirrors {@link ensureLinks}. */
  private ensureFormFields(pageNumber: number): void {
    if (!this.doc || !this.doc.formHandle || this.pageFormFields.has(pageNumber)) return;
    const page = this.doc.pages[pageNumber - 1];
    if (!page || !page.isLoaded) return;
    const generation = this.arrangementGeneration;
    const promise = page.loadFormFields().then((fields) => {
      if (generation === this.arrangementGeneration) {
        this.pageFormFields.set(pageNumber, fields);
        this.invalidate();
      }
      return fields;
    });
    this.pageFormFields.set(pageNumber, promise);
  }

  private getLoadedFormFields(pageNumber: number): PdfFormField[] | null {
    const fields = this.pageFormFields.get(pageNumber);
    return fields instanceof Promise ? null : (fields ?? null);
  }

  private selectablePages(): SelectablePage[] {
    if (!this.layout) return [];
    return this.pageGeoms.map((page, i) => ({
      page,
      pageRect: this.layout!.pageLayouts[i]!,
      text: this.getLoadedText(i + 1),
    }));
  }

  private updateAnchors(): void {
    if (this.selA && this.selB && this.layout) {
      this.anchors = computeSelectionAnchors(this.selA, this.selB, (pageNumber) => ({
        page: this.pageGeoms[pageNumber - 1]!,
        pageRect: this.layout!.pageLayouts[pageNumber - 1]!,
      }));
    } else {
      this.anchors = null;
    }
    this.notifySelectionChanged();
    this.invalidate();
  }

  /**
   * Builds a {@link PdfTextSelection} snapshot of the current selection. The
   * snapshot captures the endpoints; text/geometry are resolved on demand.
   */
  private buildSelection(): PdfTextSelection {
    const a = this.selA;
    const b = this.selB;
    if (!a || !b) {
      return {
        isEmpty: true,
        range: null,
        getSelectedTextRanges: () => Promise.resolve([]),
        getSelectedText: () => Promise.resolve(''),
      };
    }
    const [first, last] = selectionPointLE(a, b) ? [a, b] : [b, a];
    const resolveRanges = (): Promise<PdfSelectedTextRange[]> => this.resolveSelectedRanges(a, b);
    return {
      isEmpty: false,
      range: {
        start: { pageNumber: first.text.pageNumber, index: first.index },
        end: { pageNumber: last.text.pageNumber, index: last.index },
      },
      getSelectedTextRanges: resolveRanges,
      async getSelectedText(): Promise<string> {
        return (await resolveRanges()).map((r) => r.text).join('\n');
      },
    };
  }

  /**
   * Resolves a selection (given its raw endpoints) into per-page ranges with
   * text and geometry, loading the text of intermediate pages as needed.
   */
  private async resolveSelectedRanges(a: SelectionPoint, b: SelectionPoint): Promise<PdfSelectedTextRange[]> {
    const firstPage = Math.min(a.text.pageNumber, b.text.pageNumber);
    const lastPage = Math.max(a.text.pageNumber, b.text.pageNumber);
    // Endpoints are always on loaded pages; load any fully-covered pages between.
    const pending: Promise<PdfPageText | null>[] = [];
    for (let n = firstPage + 1; n < lastPage; n++) pending.push(this.loadTextAsync(n));
    await Promise.all(pending);
    return getSelectedRanges(a, b, (n) => this.getLoadedText(n)).map((r) => ({
      pageNumber: r.pageText.pageNumber,
      start: r.start,
      end: r.end,
      text: r.pageText.fullText.substring(r.start, r.end),
      bounds: rangeBounds(r),
      charRects: r.pageText.charRects.slice(r.start, r.end),
    }));
  }

  /** Ensures a page's text is loaded and resolves to it (or `null` if unavailable). */
  private async loadTextAsync(pageNumber: number): Promise<PdfPageText | null> {
    this.ensureText(pageNumber);
    const t = this.pageTexts.get(pageNumber);
    return t instanceof Promise ? await t : (t ?? null);
  }

  /** A stable identity for the current selection range (or `'empty'`). */
  private selectionSignature(): string {
    if (!this.selA || !this.selB) return 'empty';
    return `${this.selA.text.pageNumber}:${this.selA.index}|${this.selB.text.pageNumber}:${this.selB.index}`;
  }

  /** Notifies selection-change listeners, unless the range is unchanged. */
  private notifySelectionChanged(): void {
    const sig = this.selectionSignature();
    if (sig === this.lastSelectionSig) return;
    this.lastSelectionSig = sig;
    if (this.selectionChangeListeners.size === 0) return;
    const selection = this.buildSelection();
    for (const listener of this.selectionChangeListeners) {
      try {
        listener(selection);
      } catch (e) {
        console.error('Error in selection change listener:', e);
      }
    }
  }

  /** Notifies page-change listeners when the current page differs from last time. */
  private notifyPageChanged(page: number | null): void {
    if (page === this.lastNotifiedPage) return;
    this.lastNotifiedPage = page;
    for (const listener of this.pageChangeListeners) {
      try {
        listener(page);
      } catch (e) {
        console.error('Error in page change listener:', e);
      }
    }
  }

  /** Notifies transform-change listeners when the view actually moved. */
  private notifyTransformChanged(t: ViewTransform): void {
    const last = this.lastNotifiedTransform;
    if (last && last.zoom === t.zoom && last.xZoomed === t.xZoomed && last.yZoomed === t.yZoomed) return;
    this.lastNotifiedTransform = { ...t };
    for (const listener of this.transformChangeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in transform change listener:', e);
      }
    }
  }

  /**
   * Move the active selection end to the character nearest the given view
   * position (used by both text-drag and handle-drag).
   */
  private updateSelectionToViewPoint(local: Offset): void {
    if (this.mode.kind !== 'select' && this.mode.kind !== 'dragHandle') return;
    const margin = this.mode.kind === 'dragHandle' ? 16 : 8;
    const p = findTextAndIndexForPoint(viewToDocument(this.transform, local), this.selectablePages(), margin);
    if (!p) return;
    if (this.mode.kind === 'dragHandle' && this.mode.part === 'a') {
      this.selA = p;
    } else {
      this.selB = p;
    }
    this.updateAnchors();
  }

  // ---- Auto-scroll while a selection drag approaches the view edge ----

  private static readonly AUTO_SCROLL_EDGE = 24;
  private static readonly AUTO_SCROLL_FACTOR = 0.2;
  private autoScrollTimer: ReturnType<typeof setInterval> | null = null;
  private dragPointerView: Offset | null = null;

  /** Scroll vector (view px per tick) for a pointer position; zero when not at an edge. */
  private autoScrollVector(local: Offset): Offset {
    const m = PdfrxViewer.AUTO_SCROLL_EDGE;
    const k = PdfrxViewer.AUTO_SCROLL_FACTOR;
    const dx = local.x < m ? local.x - m : local.x > this.viewSize.width - m ? local.x - (this.viewSize.width - m) : 0;
    const dy = local.y < m ? local.y - m : local.y > this.viewSize.height - m ? local.y - (this.viewSize.height - m) : 0;
    return { x: dx * k, y: dy * k };
  }

  private maybeAutoScroll(local: Offset): void {
    this.dragPointerView = local;
    const v = this.autoScrollVector(local);
    if (v.x === 0 && v.y === 0) {
      this.stopAutoScroll();
      return;
    }
    if (this.autoScrollTimer !== null) return;
    this.autoScrollTimer = setInterval(() => {
      if ((this.mode.kind !== 'select' && this.mode.kind !== 'dragHandle') || !this.dragPointerView) {
        this.stopAutoScroll();
        return;
      }
      const vec = this.autoScrollVector(this.dragPointerView);
      if (vec.x === 0 && vec.y === 0) {
        this.stopAutoScroll();
        return;
      }
      const before = this.transform;
      this.setTransform({
        zoom: before.zoom,
        xZoomed: before.xZoomed - vec.x,
        yZoomed: before.yZoomed - vec.y,
      });
      if (this.transform.xZoomed === before.xZoomed && this.transform.yZoomed === before.yZoomed) {
        this.stopAutoScroll(); // fully clamped; nothing to scroll
        return;
      }
      // The content moved under the stationary pointer: retarget the selection.
      this.updateSelectionToViewPoint(this.dragPointerView);
    }, 30);
  }

  private stopAutoScroll(): void {
    if (this.autoScrollTimer !== null) {
      clearInterval(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
  }

  // ---- Inertia (fling) scrolling ----

  /** Recent pointer positions used for release-velocity estimation. */
  private readonly velocitySamples: { time: number; x: number; y: number }[] = [];
  private flingTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly VELOCITY_WINDOW_MS = 100;
  private static readonly FLING_MIN_VELOCITY = 80; // px/s to start
  private static readonly FLING_STOP_VELOCITY = 20; // px/s to stop
  private static readonly FLING_FRICTION_TAU = 350; // ms; velocity *= exp(-dt/tau)

  private recordVelocitySample(time: number, local: Offset): void {
    this.velocitySamples.push({ time, x: local.x, y: local.y });
    const cutoff = time - PdfrxViewer.VELOCITY_WINDOW_MS;
    while (this.velocitySamples.length > 0 && this.velocitySamples[0]!.time < cutoff) {
      this.velocitySamples.shift();
    }
  }

  private startFling(releaseTime: number): void {
    const samples = this.velocitySamples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    this.velocitySamples.length = 0;
    if (!first || !last || last.time - first.time < 10 || releaseTime - last.time > 100) return;
    const dt = (last.time - first.time) / 1000;
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) < PdfrxViewer.FLING_MIN_VELOCITY) return;

    let prev = performance.now();
    this.flingTimer = setInterval(() => {
      const now = performance.now();
      const tick = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      const before = this.transform;
      this.setTransform({
        zoom: before.zoom,
        xZoomed: before.xZoomed + vx * tick,
        yZoomed: before.yZoomed + vy * tick,
      });
      // Kill velocity on axes that hit the boundary (transform got clamped).
      if (Math.abs(this.transform.xZoomed - (before.xZoomed + vx * tick)) > 0.5) vx = 0;
      if (Math.abs(this.transform.yZoomed - (before.yZoomed + vy * tick)) > 0.5) vy = 0;
      const decay = Math.exp(-(tick * 1000) / PdfrxViewer.FLING_FRICTION_TAU);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < PdfrxViewer.FLING_STOP_VELOCITY) this.stopFling();
    }, 16);
  }

  private stopFling(): void {
    if (this.flingTimer !== null) {
      clearInterval(this.flingTimer);
      this.flingTimer = null;
    }
  }

  /** Hit-test the selection handles in view coordinates. */
  private hitTestHandle(viewPoint: Offset): 'a' | 'b' | null {
    if (!this.anchors || !this.showHandles) return null;
    for (const part of ['a', 'b'] as const) {
      const p = documentToView(this.transform, anchorPoint(this.anchors[part]));
      const dx = p.x - viewPoint.x;
      const dy = p.y - viewPoint.y;
      if (dx * dx + dy * dy <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) return part;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Pointer state machine
  // -------------------------------------------------------------------------

  private capturePointer(pointerId: number): void {
    // The pointer may already be released (or synthetic); capture is
    // best-effort and interaction must not depend on it succeeding.
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  private localPoint(e: PointerEvent | MouseEvent): Offset {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onPointerDownCore(e);
    this.reconcileInteraction();
  };

  private onPointerDownCore(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    // A pointerdown that reaches the canvas is on an empty area (annotation
    // shapes sit on the overlay above), so clear any annotation selection.
    if (this.selectedAnnotationIds.size) this.setSelectedAnnotations([]);
    this.lastPointerType = e.pointerType;
    this.hideContextMenu();
    this.stopFling();
    this.stopAnimation();
    this.velocitySamples.length = 0;
    const local = this.localPoint(e);

    // Second pointer while panning -> pinch
    if (this.mode.kind === 'pan' && e.pointerType === 'touch' && this.options.zoomEnabled !== false) {
      this.cancelLongPress();
      const first = this.mode.pointerId;
      const firstPos = { x: this.mode.lastX, y: this.mode.lastY };
      const distance = Math.hypot(local.x - firstPos.x, local.y - firstPos.y);
      const mid = { x: (local.x + firstPos.x) / 2, y: (local.y + firstPos.y) / 2 };
      this.mode = {
        kind: 'pinch',
        pointers: [first, e.pointerId],
        startDistance: Math.max(distance, 1),
        startZoom: this.transform.zoom,
        startDocCenter: viewToDocument(this.transform, mid),
      };
      this.capturePointer(e.pointerId);
      return;
    }
    if (this.mode.kind !== 'none') return;

    // Non-primary buttons (right/middle click) never start an interaction;
    // the contextmenu event shows the menu without touching the selection.
    if (e.button !== 0) return;

    this.capturePointer(e.pointerId);
    const docPoint = viewToDocument(this.transform, local);

    // 1) selection handle?
    const handle = this.hitTestHandle(local);
    if (handle) {
      this.mode = { kind: 'dragHandle', pointerId: e.pointerId, part: handle, pointerType: e.pointerType };
      return;
    }

    // Form fields are edited via HTML controls in the overlay layer (they sit
    // above the canvas and capture their own pointer events), so the canvas
    // pointer path does not special-case them.

    // 2) mouse: press on text starts a selection drag; otherwise pan.
    if (e.pointerType === 'mouse' && e.button === 0) {
      const p = findTextAndIndexForPoint(docPoint, this.selectablePages());
      if (p) {
        this.mode = { kind: 'select', pointerId: e.pointerId, moved: false };
        this.selA = p;
        this.selB = null;
        this.showHandles = false;
        this.updateAnchors();
        return;
      }
    }

    // 3) pan (touch always starts as pan; long-press upgrades to word select)
    if (this.options.panEnabled === false) {
      // Pan disabled: still allow touch long-press word selection, but no drag-pan.
      if (e.pointerType === 'touch') {
        this.mode = { kind: 'pan', pointerId: e.pointerId, lastX: local.x, lastY: local.y, moved: false, startedAt: e.timeStamp };
        this.startLongPress(docPoint);
      }
      return;
    }
    this.mode = { kind: 'pan', pointerId: e.pointerId, lastX: local.x, lastY: local.y, moved: false, startedAt: e.timeStamp };
    if (e.pointerType === 'touch') {
      this.startLongPress(docPoint);
    }
  }

  private startLongPress(docPoint: Offset): void {
    this.cancelLongPress();
    this.longPressTimer = setTimeout(() => {
      if (this.mode.kind === 'pan' && !this.mode.moved) {
        this.emitTap('longPress', documentToView(this.transform, docPoint));
        const word = selectWordAt(docPoint, this.selectablePages());
        if (word) {
          this.selA = word.selA;
          this.selB = word.selB;
          this.showHandles = true;
          this.mode = { kind: 'none' };
          this.pendingMenuOnUp = true;
          this.updateAnchors();
        }
      }
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const local = this.localPoint(e);
    switch (this.mode.kind) {
      case 'none': {
        // hover feedback (mouse): link > handle > text > background
        if (e.pointerType === 'mouse') {
          const docPoint = viewToDocument(this.transform, local);
          const overHandle = this.hitTestHandle(local);
          const link = overHandle ? null : this.linkAt(docPoint);
          const p = overHandle || link ? null : findTextAndIndexForPoint(docPoint, this.selectablePages());
          this.canvas.style.cursor = link ? 'pointer' : overHandle ? 'grab' : p ? 'text' : 'default';
          if (link?.link !== this.hoveredLink?.link) {
            this.hoveredLink = link;
            this.invalidate();
          }
        }
        return;
      }
      case 'pan': {
        if (e.pointerId !== this.mode.pointerId) return;
        let dx = local.x - this.mode.lastX;
        let dy = local.y - this.mode.lastY;
        if (!this.mode.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        this.mode.moved = true;
        this.cancelLongPress();
        this.mode.lastX = local.x;
        this.mode.lastY = local.y;
        if (this.options.panEnabled === false) return; // moved, but pan is disabled
        [dx, dy] = this.constrainPan(dx, dy, this.mode);
        this.recordVelocitySample(e.timeStamp, local);
        this.setTransform({
          zoom: this.transform.zoom,
          xZoomed: this.transform.xZoomed + dx,
          yZoomed: this.transform.yZoomed + dy,
        });
        return;
      }
      case 'select': {
        if (e.pointerId !== this.mode.pointerId) return;
        this.mode.moved = true;
        this.updateSelectionToViewPoint(local);
        this.maybeAutoScroll(local);
        return;
      }
      case 'dragHandle': {
        if (e.pointerId !== this.mode.pointerId) return;
        this.updateSelectionToViewPoint(local);
        this.maybeAutoScroll(local);
        return;
      }
      case 'pinch': {
        const [id0, id1] = this.mode.pointers;
        if (e.pointerId !== id0 && e.pointerId !== id1) return;
        // Track the moving pointer against the stored midpoint approach:
        // simplest robust approach — recompute from both current positions is
        // not possible with single-event data, so track per-event distances.
        // We approximate by scaling around the fixed doc center using the
        // latest distance between the two captured pointers.
        this.pinchPositions.set(e.pointerId, local);
        const p0 = this.pinchPositions.get(id0);
        const p1 = this.pinchPositions.get(id1);
        if (!p0 || !p1) return;
        const distance = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), 1);
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const zoom = Math.min(Math.max((this.mode.startZoom * distance) / this.mode.startDistance, this.minZoom), this.maxZoom);
        this.setTransform({
          zoom,
          xZoomed: mid.x - this.mode.startDocCenter.x * zoom,
          yZoomed: mid.y - this.mode.startDocCenter.y * zoom,
        });
        return;
      }
    }
  };

  private readonly pinchPositions = new Map<number, Offset>();

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.cancelLongPress();
    this.stopAutoScroll();
    this.pinchPositions.delete(e.pointerId);
    switch (this.mode.kind) {
      case 'pan':
        if (e.pointerId === this.mode.pointerId) {
          const moved = this.mode.moved;
          this.mode = { kind: 'none' };
          if (!moved) {
            const local = this.localPoint(e);
            if (e.pointerType === 'touch' && this.consumeDoubleTap(local, e.timeStamp)) {
              this.emitTap('doubleTap', local);
              this.zoomToggle(local, this.defaultAnimationDuration || 250);
            } else {
              this.handleTap(local);
            }
          } else if (e.pointerType === 'touch' && this.options.panEnabled !== false) {
            this.startFling(e.timeStamp);
          }
        }
        break;
      case 'select':
        if (e.pointerId === this.mode.pointerId) {
          if (!this.mode.moved) this.handleTap(this.localPoint(e));
          this.mode = { kind: 'none' };
        }
        break;
      case 'dragHandle':
        if (e.pointerId === this.mode.pointerId) {
          const wasTouch = this.mode.pointerType === 'touch';
          this.mode = { kind: 'none' };
          this.invalidate(); // remove the magnifier
          if (wasTouch && this.selA && this.selB) this.showContextMenuNearSelection();
        }
        break;
      case 'pinch': {
        const [id0, id1] = this.mode.pointers;
        if (e.pointerId === id0 || e.pointerId === id1) this.mode = { kind: 'none' };
        break;
      }
      default:
        break;
    }
    if (this.pendingMenuOnUp && e.pointerType === 'touch') {
      this.pendingMenuOnUp = false;
      if (this.selA && this.selB) this.showContextMenuNearSelection();
    }
    this.reconcileInteraction();
  };

  /** Fires onInteractionStart/End when the gesture state crosses idle↔active. */
  private reconcileInteraction(): void {
    const active = this.mode.kind !== 'none';
    if (active === this.interactionActive) return;
    this.interactionActive = active;
    const cb = active ? this.options.onInteractionStart : this.options.onInteractionEnd;
    if (cb) {
      try {
        cb();
      } catch (e) {
        console.error('Error in interaction callback:', e);
      }
    }
  }

  /** Delivers a discrete tap gesture to {@link PdfrxViewerOptions.onGeneralTap}. */
  private emitTap(type: PdfViewerTapType, viewPoint: Offset): void {
    const cb = this.options.onGeneralTap;
    if (!cb) return;
    try {
      cb({ type, viewPoint });
    } catch (e) {
      console.error('Error in onGeneralTap handler:', e);
    }
  }

  /** Tap (press without move): open a link if hit, otherwise clear the selection. */
  private handleTap(local: Offset): void {
    this.emitTap('tap', local);
    const link = this.linkAt(viewToDocument(this.transform, local));
    if (link) {
      this.openLink(link.link);
      return;
    }
    this.clearSelection();
  }

  /**
   * Records a touch tap and reports whether it completes a double-tap (two taps
   * close in time and space). Returns false — and does not arm — when
   * {@link PdfrxViewerOptions.doubleTapToZoom} is disabled.
   */
  private consumeDoubleTap(local: Offset, time: number): boolean {
    if (this.options.doubleTapToZoom === false) {
      this.lastTap = null;
      return false;
    }
    const prev = this.lastTap;
    if (prev && time - prev.time <= DOUBLE_TAP_MS && Math.hypot(local.x - prev.x, local.y - prev.y) <= DOUBLE_TAP_SLOP) {
      this.lastTap = null;
      return true;
    }
    this.lastTap = { time, x: local.x, y: local.y };
    return false;
  }

  private readonly onDoubleClick = (e: MouseEvent): void => {
    const local = this.localPoint(e);
    this.emitTap('doubleTap', local);
    if (this.options.doubleClickToZoom) {
      this.zoomToggle(local, this.defaultAnimationDuration || 250);
    } else {
      this.selectWordAtPoint(local);
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.hideContextMenu();
    this.stopFling();
    const local = this.localPoint(e);
    if (e.ctrlKey || e.metaKey) {
      if (this.options.zoomEnabled === false) return;
      this.zoomAt(local, this.transform.zoom * Math.exp(-e.deltaY * 0.002));
    } else {
      if (this.options.scrollByMouseWheel === false) return;
      let dx = e.deltaX;
      let dy = e.deltaY;
      // In horizontal layout, a plain vertical wheel scrolls sideways through
      // the pages (shift+wheel and trackpad horizontal deltas still work).
      if (this.layoutDirectionValue === 'horizontal' && dx === 0 && !e.shiftKey) {
        dx = dy;
        dy = 0;
      }
      this.setTransform({
        zoom: this.transform.zoom,
        xZoomed: this.transform.xZoomed - dx,
        yZoomed: this.transform.yZoomed - dy,
      });
    }
  };

  /** Document-space distance scrolled per arrow-key press (view px). */
  private static readonly SCROLL_BY_ARROW_KEY = 25;

  // Keyboard navigation handler.
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const cmd = e.ctrlKey || e.metaKey;
    const k = PdfrxViewer.SCROLL_BY_ARROW_KEY;
    const handled = ((): boolean => {
      // Undo/redo: Ctrl/Cmd+Z, and Ctrl/Cmd+Shift+Z or Ctrl+Y to redo.
      if (cmd && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) void this.redo();
        else void this.undo();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'y') {
        void this.redo();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'd' && this.canRepeatAnnotationDuplicate()) {
        void this.repeatAnnotationDuplicate();
        return true;
      }
      // Delete/Backspace removes the selected annotation(s).
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedAnnotationIds.size) {
        void this.deleteSelectedAnnotation();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'c') {
        if (this.selectedAnnotationIds.size) this.copySelectedAnnotations();
        else void this.copySelection();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'x' && this.selectedAnnotationIds.size) {
        void this.cutSelectedAnnotations();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'v' && this.annotationClipboard.length) {
        void this.pasteAnnotations();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'a') {
        if (this.isAnnotationSelectMode()) void this.selectAllAnnotationsOnPage();
        else void this.selectAll();
        return true;
      }
      switch (e.key) {
        case 'Escape':
          // Cancel the active tool / select mode / annotation selection first,
          // else fall back to clearing the text selection.
          if (this.annotationMode !== null) {
            this.annotationMode = null;
            this.setSelectedAnnotations([]);
            this.invalidate();
            return true;
          }
          if (this.selectedAnnotationIds.size) {
            this.setSelectedAnnotations([]);
            return true;
          }
          this.clearSelection();
          return true;
        case 'PageUp':
          return this.goToRelativePage(-1);
        case 'PageDown':
          return this.goToRelativePage(1);
        case ' ':
          return this.goToRelativePage(e.shiftKey ? -1 : 1);
        case 'Home':
          this.goToPage(1);
          return true;
        case 'End':
          this.goToPage(this.doc?.pages.length ?? 1);
          return true;
        case 'ArrowDown':
          return this.scrollByKey(0, k);
        case 'ArrowUp':
          return this.scrollByKey(0, -k);
        case 'ArrowLeft':
          return this.scrollByKey(-k, 0);
        case 'ArrowRight':
          return this.scrollByKey(k, 0);
        case '+':
        case '=':
          if (cmd) {
            this.zoomUp();
            return true;
          }
          return false;
        case '-':
          if (cmd) {
            this.zoomDown();
            return true;
          }
          return false;
        default:
          return false;
      }
    })();
    if (handled) e.preventDefault();
  };

  private goToRelativePage(delta: number): boolean {
    if (!this.doc) return false;
    const current = this.currentPageNumber;
    if (current === null) return false;
    const target = Math.min(Math.max(current + delta, 1), this.doc.pages.length);
    if (target !== current) this.goToPage(target);
    return true;
  }

  /**
   * Scroll the view content; positive dy scrolls down (like arrow-down). Returns
   * whether it acted (false when {@link PdfrxViewerOptions.scrollByArrowKey} is
   * disabled).
   */
  private scrollByKey(dx: number, dy: number): boolean {
    if (this.options.scrollByArrowKey === false) return false;
    this.setTransform({
      zoom: this.transform.zoom,
      xZoomed: this.transform.xZoomed - dx,
      yZoomed: this.transform.yZoomed - dy,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Context menu (DOM chrome)
  // -------------------------------------------------------------------------

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const local = this.localPoint(e);
    this.emitTap('secondaryTap', local);
    this.showContextMenu(local);
  };

  private showContextMenuNearSelection(): void {
    if (!this.anchors) return;
    const p = documentToView(this.transform, anchorPoint(this.anchors.b));
    // On touch the finger is sitting on the selection end, so drop the menu
    // below-left of it rather than under the fingertip.
    if (this.lastPointerType === 'touch') this.showContextMenu({ x: p.x - 24, y: p.y + 28 });
    else this.showContextMenu({ x: p.x + 8, y: p.y + 8 });
  }

  private showContextMenu(viewPos: Offset): void {
    this.hideContextMenu();
    const builder = this.options.contextMenuBuilder;
    const menu = builder
      ? builder({
          viewPoint: viewPos,
          hasSelection: !!(this.selA && this.selB),
          isCopyAllowed: this.isCopyAllowed,
          pointerType: this.lastPointerType,
          close: () => this.hideContextMenu(),
        })
      : this.buildDefaultContextMenu();
    if (!menu) return;
    // The viewer owns placement and dismissal regardless of who built the menu.
    menu.style.position = 'absolute';
    this.container.appendChild(menu);
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const x = Math.max(4, Math.min(viewPos.x, this.viewSize.width - mw - 4));
    const y = Math.max(4, Math.min(viewPos.y, this.viewSize.height - mh - 4));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    this.menuEl = menu;
  }

  /** The built-in Copy / Select All menu (English), used when no builder is set. */
  private buildDefaultContextMenu(): HTMLElement {
    const touch = this.lastPointerType === 'touch';
    const menu = document.createElement('div');
    menu.style.cssText =
      'z-index:10;background:#fff;color:#111;border:1px solid #ccc;border-radius:6px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.25);padding:4px;' +
      `font:${touch ? 15 : 13}px system-ui,sans-serif;min-width:${touch ? 160 : 130}px;` +
      'display:flex;flex-direction:column;user-select:none;touch-action:manipulation;';
    const addItem = (label: string, enabled: boolean, action: () => void): void => {
      const item = document.createElement('button');
      item.textContent = label;
      item.disabled = !enabled;
      // Touch needs a target you can actually hit; a mouse does not.
      item.style.cssText =
        `all:unset;padding:${touch ? '12px 16px' : '6px 12px'};border-radius:4px;cursor:pointer;` +
        (touch ? 'min-height:22px;' : '') +
        (enabled ? '' : 'color:#aaa;cursor:default;');
      if (enabled) {
        item.addEventListener('mouseenter', () => (item.style.background = '#eee'));
        item.addEventListener('mouseleave', () => (item.style.background = ''));
        item.addEventListener('click', action);
      }
      menu.appendChild(item);
    };
    addItem('Copy', !!(this.selA && this.selB) && this.isCopyAllowed, () => {
      void this.copySelection().then(() => this.clearSelection());
    });
    addItem('Highlight', this.canHighlightSelection(), () => {
      this.hideContextMenu();
      void this.highlightSelection();
    });
    addItem('Select All', true, () => {
      this.hideContextMenu();
      void this.selectAll();
    });
    return menu;
  }

  private hideContextMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

  /**
   * Repaints synchronously, cancelling any scheduled paint. Used when a blank
   * frame would be visible otherwise — notably right after resizing the canvas,
   * which clears its bitmap (see {@link onResize}).
   */
  private paintNow(): void {
    if (this.disposed) return;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.paintTimer !== null) {
      clearTimeout(this.paintTimer);
      this.paintTimer = null;
    }
    this.paint();
  }

  private invalidate(): void {
    if (this.rafId !== null || this.paintTimer !== null || this.disposed) return;
    const run = (): void => {
      this.rafId = null;
      this.paintTimer = null;
      this.paint();
    };
    // requestAnimationFrame stops firing while the document is hidden
    // (background tab, hidden iframe) — fall back to a timer there so the
    // viewer still paints when shown, and for headless environments.
    if (document.visibilityState === 'hidden') {
      this.paintTimer = setTimeout(run, 16);
    } else {
      this.rafId = requestAnimationFrame(run);
    }
  }

  /**
   * Draws the built-in loading indicator: a rotating arc, plus a progress bar
   * once the byte counts are known. Keeps repainting itself while loading.
   */
  private paintLoading(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (this.options.loadingIndicator !== false) {
      const cx = (this.viewSize.width / 2) * dpr;
      const cy = (this.viewSize.height / 2) * dpr;
      const radius = 18 * dpr;
      const color = this.options.loadingIndicatorColor ?? 'rgba(255, 255, 255, 0.85)';
      const spin = (performance.now() / 700) * Math.PI * 2;

      ctx.lineWidth = 3 * dpr;
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, spin, spin + Math.PI * 0.6);
      ctx.stroke();

      const progress = this.loadingProgressValue;
      if (progress && progress.bytesTotal) {
        const width = Math.min(220 * dpr, this.canvas.width - 40 * dpr);
        const height = 4 * dpr;
        const left = cx - width / 2;
        const top = cy + radius + 16 * dpr;
        const ratio = Math.max(0, Math.min(1, progress.bytesReceived / progress.bytesTotal));
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = color;
        ctx.fillRect(left, top, width, height);
        ctx.globalAlpha = 1;
        ctx.fillRect(left, top, width * ratio, height);
      }
      ctx.globalAlpha = 1;
    }
    // Keep the animation going for as long as the load lasts.
    this.invalidate();
  }

  private paint(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const t = this.transform;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.options.backgroundColor ?? '#808080';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // While opening, the previous document is deliberately not drawn: parsing
    // can take seconds, and showing the old pages with no other feedback makes
    // the viewer look frozen.
    if (this.isLoading) {
      this.paintLoading(ctx, dpr);
      return;
    }

    if (!this.layout || !this.doc || !this.cache) return;

    const visible = calcVisibleRect(t, this.viewSize);

    // Cache maintenance for visible pages
    const visiblePages = new Set<number>();
    const visibleKeys = new Set<string>();
    const requiredScale = t.zoom * dpr;
    // Track the page covering the largest visible area for onPageChanged.
    let currentPage: number | null = null;
    let currentPageArea = 0;
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectOverlaps(pageRect, visible)) continue;
      const pageNumber = i + 1;
      visiblePages.add(pageNumber);
      const renderKey = this.doc.pages[i]?.renderKey;
      if (renderKey !== undefined) visibleKeys.add(renderKey);
      const visibleOnPage = rectIntersect(pageRect, visible);
      const area = rectWidth(visibleOnPage) * rectHeight(visibleOnPage);
      if (area > currentPageArea) {
        currentPageArea = area;
        currentPage = pageNumber;
      }
      this.cache.requestBase(pageNumber, requiredScale);
      this.ensureText(pageNumber);
      this.ensureLinks(pageNumber);
      this.ensureFormFields(pageNumber);
      this.ensureAnnotations(pageNumber);
      if (requiredScale > this.cache.baseScaleCap(pageNumber) * 1.1) {
        if (!rectIsEmpty(visibleOnPage)) {
          this.cache.schedulePatch(pageNumber, visibleOnPage, pageRect, requiredScale);
        }
      }
    }
    this.cache.clearPatchesExcept(visiblePages);
    // Pages that scrolled away give up their place in the render queue, so the
    // pages now on screen are not stuck behind a backlog.
    this.cache.cancelBasesExcept(visibleKeys);
    this.notifyPageChanged(currentPage);
    this.notifyTransformChanged(t);

    // Page drop shadows behind pages (screen space, before content)
    this.paintPageShadows(dpr, t, visible);

    // Document content (pages + selection highlight) in document space
    ctx.setTransform(dpr * t.zoom, 0, 0, dpr * t.zoom, dpr * t.xZoomed, dpr * t.yZoomed);
    this.paintDocContent(visible);

    // Page borders on top of page edges (screen space, after content)
    this.paintPageBorders(dpr, t, visible);
    ctx.setTransform(dpr * t.zoom, 0, 0, dpr * t.zoom, dpr * t.xZoomed, dpr * t.yZoomed);

    // Hovered link highlight
    if (this.hoveredLink) {
      ctx.fillStyle = 'rgba(0, 100, 255, 0.15)';
      for (const r of this.hoveredLink.rects) {
        ctx.fillRect(r.left, r.top, rectWidth(r), rectHeight(r));
      }
    }

    // Selection handles (view-space, fixed pixel size)
    if (this.anchors && this.showHandles) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = this.options.handleColor ?? '#2196f3';
      for (const part of ['a', 'b'] as const) {
        const p = documentToView(t, anchorPoint(this.anchors[part]));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const anchor = this.anchors[part];
        const stemUp = part === 'a' ? rectHeight(anchor.rect) : -rectHeight(anchor.rect);
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.options.handleColor ?? '#2196f3';
        ctx.lineTo(p.x, p.y + stemUp * t.zoom);
        ctx.stroke();
      }
    }

    this.paintMagnifier(dpr);

    // Keep DOM page overlays in sync with the view transform.
    this.updateOverlays();
    this.updateFormOverlays();
    this.updateAnnotationOverlays();
  }

  // -------------------------------------------------------------------------
  // Page overlays (DOM elements that follow each page)
  // -------------------------------------------------------------------------

  /**
   * Rebuilds all page overlays from {@link PdfrxViewerOptions.pageOverlaysBuilder}.
   * Call this after the state your builder depends on has changed.
   */
  refreshOverlays(): void {
    this.overlayContainers.clear();
    this.overlayRoot.replaceChildren();
    this.invalidate();
  }

  /**
   * Sets (or clears with `null`) the page overlays builder and rebuilds
   * overlays. Convenience for callers that construct the viewer without the
   * {@link PdfrxViewerOptions.pageOverlaysBuilder} option (e.g. the custom element).
   */
  setPageOverlaysBuilder(builder: PageOverlaysBuilder | null): void {
    this.options.pageOverlaysBuilder = builder ?? undefined;
    this.refreshOverlays();
  }

  /**
   * Rebuilds the viewport-fixed overlays from
   * {@link PdfrxViewerOptions.viewerOverlayBuilder}. Called automatically on
   * resize and document change; call this after your builder's inputs change.
   */
  refreshViewerOverlays(): void {
    this.buildViewerOverlays();
  }

  /**
   * Sets (or clears with `null`) the viewport-fixed overlay builder and rebuilds
   * it. Convenience for callers that construct the viewer without the
   * {@link PdfrxViewerOptions.viewerOverlayBuilder} option.
   */
  setViewerOverlayBuilder(builder: ViewerOverlayBuilder | null): void {
    this.options.viewerOverlayBuilder = builder ?? undefined;
    this.buildViewerOverlays();
  }

  private buildViewerOverlays(): void {
    this.viewerOverlayRoot.replaceChildren();
    const builder = this.options.viewerOverlayBuilder;
    if (!builder || this.viewSize.width <= 0 || this.viewSize.height <= 0) return;
    let built: HTMLElement | HTMLElement[] | null | undefined;
    try {
      built = builder({ viewSize: this.viewSize });
    } catch (e) {
      console.error('Error in viewerOverlayBuilder:', e);
      return;
    }
    if (!built) return;
    for (const el of Array.isArray(built) ? built : [built]) this.viewerOverlayRoot.appendChild(el);
  }

  /** Positions/builds per-page overlay containers to follow the view transform. */
  private updateOverlays(): void {
    const builder = this.options.pageOverlaysBuilder;
    if (!builder || !this.layout || !this.doc) {
      if (this.overlayRoot.childElementCount) this.overlayRoot.replaceChildren();
      this.overlayContainers.clear();
      return;
    }
    const t = this.transform;
    const visible = calcVisibleRect(t, this.viewSize);
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      const onScreen = rectOverlaps(pageRect, visible);
      const pageNumber = i + 1;
      let container = this.overlayContainers.get(pageNumber);
      if (onScreen && !container) {
        const built = this.buildOverlayContainer(pageNumber, pageRect, builder);
        if (built) {
          container = built;
          this.overlayContainers.set(pageNumber, built);
          this.overlayRoot.appendChild(built);
        }
      }
      if (!container) continue;
      if (onScreen) {
        const vr = documentRectToView(t, pageRect);
        container.style.display = '';
        container.style.transform = `translate(${vr.left}px, ${vr.top}px) scale(${t.zoom})`;
      } else {
        container.style.display = 'none';
      }
    }
  }

  /** Builds one page's overlay container by invoking the builder, or null if it produced nothing. */
  private buildOverlayContainer(
    pageNumber: number,
    pageRect: Rect,
    builder: PageOverlaysBuilder,
  ): HTMLElement | null {
    const page = this.doc?.pages[pageNumber - 1];
    if (!page) return null;
    const pageSize: Size = { width: rectWidth(pageRect), height: rectHeight(pageRect) };
    let result: HTMLElement | HTMLElement[] | null | undefined;
    try {
      result = builder({ pageNumber, page, pageSize });
    } catch (e) {
      console.error('Error in pageOverlaysBuilder:', e);
      return null;
    }
    const els = result == null ? [] : Array.isArray(result) ? result : [result];
    if (els.length === 0) return null;
    const container = document.createElement('div');
    // The container spans the page in point-space; transform-origin at its
    // top-left so translate+scale map point-space onto the current view rect.
    // Click-through by default (children opt in with pointer-events: auto).
    container.style.cssText =
      `position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;` +
      `width:${pageSize.width}px;height:${pageSize.height}px;`;
    for (const el of els) container.appendChild(el);
    return container;
  }

  // -------------------------------------------------------------------------
  // Form overlay: native HTML controls laid over AcroForm widgets.
  // -------------------------------------------------------------------------

  /**
   * Positions/builds the per-page form-control overlays to follow the view
   * transform. Mirrors {@link updateOverlays}; called from the paint loop.
   */
  private updateFormOverlays(): void {
    if (this.options.interactiveForms === false || !this.layout || !this.doc || !this.doc.formHandle) {
      if (this.formOverlays.size) this.clearFormOverlays();
      return;
    }
    const t = this.transform;
    const visible = calcVisibleRect(t, this.viewSize);
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      const onScreen = rectOverlaps(pageRect, visible);
      const pageNumber = i + 1;
      let overlay = this.formOverlays.get(pageNumber);
      if (onScreen && !overlay) {
        const fields = this.getLoadedFormFields(pageNumber);
        if (fields && fields.length) {
          const built = this.buildFormPageOverlay(fields, this.pageGeoms[i]!, pageRect);
          if (built) {
            overlay = built;
            this.formOverlays.set(pageNumber, built);
            this.formOverlayRoot.appendChild(built.container);
          }
        }
      }
      if (!overlay) continue;
      if (onScreen) {
        const vr = documentRectToView(t, pageRect);
        overlay.container.style.display = '';
        overlay.container.style.transform = `translate(${vr.left}px, ${vr.top}px) scale(${t.zoom})`;
      } else {
        overlay.container.style.display = 'none';
      }
    }
  }

  /** Builds one page's form overlay container from its fields, or null if empty. */
  private buildFormPageOverlay(
    fields: readonly PdfFormField[],
    pageGeom: PageGeometry,
    pageRect: Rect,
  ): FormPageOverlay | null {
    const pageSize: Size = { width: rectWidth(pageRect), height: rectHeight(pageRect) };
    const container = document.createElement('div');
    // Point-space container (origin at the page top-left); positioned with
    // translate+scale(zoom) by updateFormOverlays. Click-through except controls.
    container.style.cssText =
      `position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;` +
      `width:${pageSize.width}px;height:${pageSize.height}px;`;
    const controls = new Map<string, (field: PdfFormField) => void>();
    for (const field of fields) {
      for (const el of this.buildFormControls(field, pageGeom, pageSize, controls)) container.appendChild(el);
    }
    if (container.childElementCount === 0) return null;
    return { container, controls };
  }

  /**
   * Builds the native control(s) for one field, positioned in the container's
   * point-space, and registers a reconciler in `controls` (keyed by field name).
   * Read-only fields render as *disabled* controls (so calculated totals still
   * display and reconcile); unnamed, push-button and signature fields get no
   * control — the canvas renders them.
   */
  private buildFormControls(
    field: PdfFormField,
    pageGeom: PageGeometry,
    pageSize: Size,
    controls: Map<string, (field: PdfFormField) => void>,
  ): HTMLElement[] {
    if (!this.doc || !field.name) return [];
    const doc = this.doc;
    const readOnly = field.flags.readOnly;
    /** Disables read-only controls (they display + reconcile but cannot be edited). */
    const disable = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void => {
      if (readOnly) {
        el.disabled = true;
        el.style.background = '#f3f3f3';
        el.style.color = '#333';
      }
    };
    const toPx = (r: PdfRect): Rect => pdfRectToRect(r, { page: pageGeom, scaledPageSize: pageSize });
    const place = (el: HTMLElement, box: Rect): void => {
      el.style.position = 'absolute';
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = `${Math.max(rectWidth(box), 1)}px`;
      el.style.height = `${Math.max(rectHeight(box), 1)}px`;
      el.style.margin = '0';
      el.style.boxSizing = 'border-box';
      el.style.pointerEvents = 'auto';
    };
    // Native checkbox/radio glyphs don't stretch, so center them in a square.
    const centeredSquare = (box: Rect): Rect => {
      const side = Math.min(rectWidth(box), rectHeight(box));
      const left = box.left + (rectWidth(box) - side) / 2;
      const top = box.top + (rectHeight(box) - side) / 2;
      return { left, top, right: left + side, bottom: top + side };
    };
    const fontPx = (box: Rect): string => `${Math.min(Math.max(rectHeight(box) * 0.62, 8), 24)}px sans-serif`;
    const commit = (value: string | boolean): void => {
      void doc.setFormFieldValue(field.name, value);
    };
    const box0 = toPx(field.rects[0]!);

    switch (field.type) {
      case 'textField': {
        const el = field.multiline ? document.createElement('textarea') : document.createElement('input');
        if (el instanceof HTMLInputElement) el.type = 'text';
        place(el, box0);
        el.value = field.value;
        el.style.font = fontPx(box0);
        el.style.padding = '0 2px';
        el.style.border = '1px solid rgba(60, 90, 160, 0.6)';
        el.style.background = '#fff';
        el.style.color = '#000';
        if (el instanceof HTMLTextAreaElement) el.style.resize = 'none';
        disable(el);
        // Commit on blur (change) so there is no per-keystroke worker round-trip.
        if (!readOnly) el.addEventListener('change', () => commit(el.value));
        controls.set(field.name, (f) => {
          if (document.activeElement !== el) el.value = f.value;
        });
        return [el];
      }
      case 'checkBox': {
        const el = document.createElement('input');
        el.type = 'checkbox';
        place(el, centeredSquare(box0));
        el.checked = !!field.isChecked;
        disable(el);
        if (!readOnly) el.addEventListener('change', () => commit(el.checked));
        controls.set(field.name, (f) => {
          if (document.activeElement !== el) el.checked = !!f.isChecked;
        });
        return [el];
      }
      case 'radioButton': {
        const inputs: HTMLInputElement[] = [];
        (field.options ?? []).forEach((opt, i) => {
          const el = document.createElement('input');
          el.type = 'radio';
          el.name = `pdfrx-radio-${field.name}`;
          place(el, centeredSquare(toPx(field.rects[i] ?? field.rects[0]!)));
          el.checked = opt.selected;
          disable(el);
          if (!readOnly)
            el.addEventListener('change', () => {
              if (el.checked) commit(opt.label);
            });
          inputs.push(el);
        });
        controls.set(field.name, (f) => {
          (f.options ?? []).forEach((opt, i) => {
            const el = inputs[i];
            if (el && document.activeElement !== el) el.checked = opt.selected;
          });
        });
        return inputs;
      }
      case 'comboBox':
      case 'listBox': {
        const el = document.createElement('select');
        place(el, box0);
        el.style.font = fontPx(box0);
        el.style.border = '1px solid rgba(60, 90, 160, 0.6)';
        el.style.background = '#fff';
        el.style.color = '#000';
        for (const opt of field.options ?? []) {
          const o = document.createElement('option');
          o.value = opt.label;
          o.textContent = opt.label;
          el.appendChild(o);
        }
        el.value = field.options?.find((o) => o.selected)?.label ?? field.value;
        disable(el);
        if (!readOnly) el.addEventListener('change', () => commit(el.value));
        controls.set(field.name, (f) => {
          if (document.activeElement !== el) el.value = f.options?.find((o) => o.selected)?.label ?? f.value;
        });
        return [el];
      }
      default:
        return [];
    }
  }

  /** Refreshes overlay control values in place after a `formFieldsChanged` event. */
  private reconcileFormOverlays(): void {
    if (!this.doc || this.formOverlays.size === 0) return;
    const generation = this.arrangementGeneration;
    for (const [pageNumber, overlay] of this.formOverlays) {
      const page = this.doc.pages[pageNumber - 1];
      if (!page) continue;
      void page
        .loadFormFields()
        .then((fields) => {
          if (generation !== this.arrangementGeneration) return;
          this.pageFormFields.set(pageNumber, fields);
          const byName = new Map(fields.map((f) => [f.name, f] as const));
          for (const [name, reconcile] of overlay.controls) {
            const f = byName.get(name);
            if (f) reconcile(f);
          }
        })
        .catch(() => {});
    }
  }

  /** Removes all form-control overlays. */
  private clearFormOverlays(): void {
    this.formOverlayRoot.replaceChildren();
    this.formOverlays.clear();
  }

  // -------------------------------------------------------------------------
  // Annotation overlay: per-page SVG painting the document's annotations.
  // -------------------------------------------------------------------------

  /** Whether the SVG annotation overlay is active (option default: on). */
  private annotationsEnabled(): boolean {
    return this.options.interactiveAnnotations !== false;
  }

  /**
   * The annotation-rendering mode for canvas renders. When the overlay is on,
   * the canvas draws form widgets but not annotations (`formsOnly`), so they are
   * not painted twice; otherwise the engine default is kept.
   */
  private canvasAnnotationRenderingMode(): PdfAnnotationRenderingMode | undefined {
    return this.annotationsEnabled() ? 'formsOnly' : undefined;
  }

  /** Loads (once) the annotations of a page position; mirrors {@link ensureFormFields}. */
  private ensureAnnotations(pageNumber: number): void {
    if (!this.doc || !this.annotationsEnabled() || this.pageAnnotations.has(pageNumber)) return;
    const page = this.doc.pages[pageNumber - 1];
    if (!page || !page.isLoaded) return;
    const generation = this.arrangementGeneration;
    const annotationGeneration = this.annotationReloadGeneration;
    const promise = page.loadAnnotations().then((annotations) => {
      if (generation === this.arrangementGeneration && annotationGeneration === this.annotationReloadGeneration) {
        this.pageAnnotations.set(pageNumber, annotations);
        this.invalidate();
      }
      return annotations;
    });
    this.pageAnnotations.set(pageNumber, promise);
  }

  private getLoadedAnnotations(pageNumber: number): PdfAnnotationObject[] | null {
    const annotations = this.pageAnnotations.get(pageNumber);
    return annotations instanceof Promise ? null : (annotations ?? null);
  }

  /**
   * Positions/builds the per-page annotation overlays to follow the view
   * transform. Mirrors {@link updateFormOverlays}; called from the paint loop.
   * A surface is built for every visible page (even with no annotations) so a
   * drawing tool always has somewhere to draw.
   */
  private updateAnnotationOverlays(): void {
    if (!this.annotationsEnabled() || !this.layout || !this.doc) {
      if (this.annotationOverlays.size) this.clearAnnotationOverlays();
      return;
    }
    const t = this.transform;
    const visible = calcVisibleRect(t, this.viewSize);
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      const onScreen = rectOverlaps(pageRect, visible);
      const pageNumber = i + 1;
      let overlay = this.annotationOverlays.get(pageNumber);
      const annotations = onScreen ? this.getLoadedAnnotations(pageNumber) : null;
      if (onScreen && overlay && annotations && this.dirtyAnnotationOverlayPages.has(pageNumber)) {
        const replacement = this.buildAnnotationPageOverlay(pageNumber, annotations, this.pageGeoms[i]!, pageRect);
        overlay.container.replaceWith(replacement.container);
        overlay.highlightContainer.replaceWith(replacement.highlightContainer);
        this.annotationOverlays.set(pageNumber, replacement);
        this.dirtyAnnotationOverlayPages.delete(pageNumber);
        overlay = replacement;
      }
      if (onScreen && !overlay) {
        if (annotations) {
          overlay = this.buildAnnotationPageOverlay(pageNumber, annotations, this.pageGeoms[i]!, pageRect);
          this.annotationOverlays.set(pageNumber, overlay);
          this.annotationOverlayRoot.appendChild(overlay.highlightContainer);
          this.annotationOverlayRoot.appendChild(overlay.container);
          this.dirtyAnnotationOverlayPages.delete(pageNumber);
        }
      }
      if (!overlay) continue;
      if (onScreen) {
        const vr = documentRectToView(t, pageRect);
        overlay.container.style.display = '';
        overlay.highlightContainer.style.display = '';
        overlay.container.style.transform = `translate(${vr.left}px, ${vr.top}px) scale(${t.zoom})`;
        overlay.highlightContainer.style.transform = overlay.container.style.transform;
        // A drawing tool or select mode makes the SVG capture drags anywhere on
        // the page (to draw / rubber-band); otherwise only the shapes are
        // interactive so empty areas still pan / select text.
        const drawing = this.drawingTool() !== null;
        const capturing = drawing || this.isAnnotationSelectMode();
        overlay.container.style.pointerEvents = capturing ? 'auto' : 'none';
        overlay.svg.style.pointerEvents = capturing ? 'auto' : 'none';
        overlay.svg.style.cursor = drawing ? 'crosshair' : this.isAnnotationSelectMode() ? 'default' : '';
        // Existing annotation shapes are genuine hit targets only in explicit
        // object-select mode. Otherwise make them click-through so normal
        // viewing can pan/select text even when a gesture starts over a shape.
        for (const child of Array.from(overlay.svg.children)) {
          const g = child as SVGGElement;
          const id = g.dataset.annotId;
          if (!id) continue;
          const annotation = overlay.annotations.get(id);
          const selected = this.selectedAnnotationIds.has(id);
          g.style.pointerEvents = this.isAnnotationSelectMode()
            ? selected || annotation?.subtype === 'freeText'
              ? 'bounding-box'
              : 'auto'
            : 'none';
          g.style.cursor = this.isAnnotationSelectMode() ? 'pointer' : '';
        }
        // Keep the selection anchors + bounding box a constant on-screen size as
        // the zoom changes.
        if (overlay.anchorLayer.childElementCount) {
          const r = `${this.annotationAnchorScreenPx() / 2 / t.zoom}`;
          const dash = `${4 / t.zoom} ${3 / t.zoom}`;
          for (const child of overlay.anchorLayer.children) {
            if (child.tagName === 'circle') {
              child.setAttribute('r', r);
              child.setAttribute('stroke-width', `${1.5 / t.zoom}`);
            } else {
              child.setAttribute('stroke-width', `${1 / t.zoom}`);
              child.setAttribute('stroke-dasharray', dash);
            }
          }
        }
      } else {
        overlay.container.style.display = 'none';
        overlay.highlightContainer.style.display = 'none';
      }
    }
  }

  /** Builds one page's annotation overlay (a point-space SVG) from its annotations. */
  private buildAnnotationPageOverlay(
    pageNumber: number,
    annotations: readonly PdfAnnotationObject[],
    pageGeom: PageGeometry,
    pageRect: Rect,
  ): AnnotationPageOverlay {
    for (const [id, snapshot] of this.annotationSnapshots) {
      if (snapshot.pageNumber === pageNumber) this.annotationSnapshots.delete(id);
    }
    const pageSize: Size = { width: rectWidth(pageRect), height: rectHeight(pageRect) };
    const container = document.createElement('div');
    // Point-space container (origin at the page top-left); positioned with
    // translate+scale(zoom) by updateAnnotationOverlays. Click-through by default.
    container.style.cssText =
      `position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;` +
      `width:${pageSize.width}px;height:${pageSize.height}px;`;
    const highlightContainer = document.createElement('div');
    highlightContainer.className = 'pdfrx-annotation-highlight-page';
    highlightContainer.style.cssText = container.style.cssText + 'mix-blend-mode:multiply;';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', `${pageSize.width}`);
    svg.setAttribute('height', `${pageSize.height}`);
    svg.setAttribute('viewBox', `0 0 ${pageSize.width} ${pageSize.height}`);
    // Prevent the browser from converting a touch drag into page scrolling and
    // cancelling our pointer stream. Empty page areas remain click-through when
    // annotation drawing/select mode is inactive, so normal viewer panning is
    // unaffected.
    svg.style.cssText =
      'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;touch-action:none;';
    const highlightSvg = document.createElementNS(SVG_NS, 'svg');
    highlightSvg.setAttribute('width', `${pageSize.width}`);
    highlightSvg.setAttribute('height', `${pageSize.height}`);
    highlightSvg.setAttribute('viewBox', `0 0 ${pageSize.width} ${pageSize.height}`);
    highlightSvg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;';
    const byId = new Map<string, PdfAnnotationObject>();
    for (const a of annotations) {
      this.annotationSnapshots.set(a.id, { pageNumber, annotation: a });
      const el = this.buildAnnotationShape(a, pageGeom, pageSize);
      if (el) {
        if (a.subtype === 'highlight') {
          el.dataset.annotVisualId = a.id;
          el.style.pointerEvents = 'none';
          highlightSvg.appendChild(el);
          const hit = el.cloneNode(true) as SVGGElement;
          hit.removeAttribute('data-annot-visual-id');
          hit.dataset.annotId = a.id;
          hit.style.opacity = '0';
          svg.appendChild(hit);
        } else {
          el.dataset.annotId = a.id;
          svg.appendChild(el);
        }
        byId.set(a.id, a);
      }
    }
    // Anchor handles for the selected annotation sit above the shapes.
    const anchorLayer = document.createElementNS(SVG_NS, 'g');
    anchorLayer.setAttribute('class', 'pdfrx-anchors');
    svg.appendChild(anchorLayer);
    container.appendChild(svg);
    highlightContainer.appendChild(highlightSvg);
    const overlay: AnnotationPageOverlay = {
      pageNumber,
      pageGeom,
      pageSize,
      container,
      svg,
      highlightContainer,
      highlightSvg,
      anchorLayer,
      annotations: byId,
    };
    this.attachAnnotationEditing(overlay, pageNumber, pageGeom, pageSize);
    this.refreshAnnotationSelection(overlay);
    return overlay;
  }

  /**
   * Builds the SVG element for one annotation in the overlay's point-space
   * (page-local px == PDF points, y-down). Returns null for subtypes we do not
   * paint.
   */
  private buildAnnotationShape(
    a: PdfAnnotationObject,
    pageGeom: PageGeometry,
    pageSize: Size,
    geometryPreview = false,
  ): SVGGElement | null {
    const toPx = (p: { x: number; y: number }): Offset =>
      pdfPointToOffset(p, { page: pageGeom, scaledPageSize: pageSize });
    const rectPx = (): Rect => pdfRectToRect(a.rect, { page: pageGeom, scaledPageSize: pageSize });
    const stroke = colorCss(a.color, '#000000');
    const fill = colorCss(a.interiorColor, null);
    const width = Math.max(0, a.borderWidth);
    const shapeStroke = width > 0 ? stroke : 'none';
    const g = document.createElementNS(SVG_NS, 'g');
    // PDF annotations expose one opacity for their entire appearance. Apply it
    // at the group level so stroke and interior fill cannot drift apart.
    const annotationAlpha = a.color?.a ?? a.interiorColor?.a ?? 255;
    g.setAttribute('opacity', `${annotationAlpha / 255}`);
    const add = (el: SVGElement): void => void g.appendChild(el);
    const addAppearancePaths = (): boolean => {
      if (!a.appearancePaths.length) return false;
      // Appearance object colors already carry their own alpha. Applying the
      // annotation alpha to the containing group would attenuate them twice.
      g.setAttribute('opacity', '1');
      for (const appearance of a.appearancePaths) {
        let pathData = '';
        for (let i = 0; i < appearance.segments.length; i++) {
          const segment = appearance.segments[i]!;
          const p = toPx(segment.point);
          if (segment.type === 'move') pathData += `M ${p.x} ${p.y} `;
          else if (segment.type === 'line') pathData += `L ${p.x} ${p.y} `;
          else {
            const control2 = appearance.segments[i + 1];
            const end = appearance.segments[i + 2];
            if (control2?.type !== 'bezier' || end?.type !== 'bezier') continue;
            const p2 = toPx(control2.point);
            const p3 = toPx(end.point);
            pathData += `C ${p.x} ${p.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y} `;
            if (end.close) pathData += 'Z ';
            i += 2;
            continue;
          }
          if (segment.close) pathData += 'Z ';
        }
        if (!pathData) continue;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', pathData.trim());
        path.setAttribute('fill', appearance.fillMode ? (colorCss(appearance.fillColor, 'none') ?? 'none') : 'none');
        path.setAttribute('fill-rule', appearance.fillMode === 1 ? 'evenodd' : 'nonzero');
        path.setAttribute('stroke', appearance.stroke ? (colorCss(appearance.strokeColor, 'none') ?? 'none') : 'none');
        path.setAttribute('stroke-width', `${appearance.strokeWidth}`);
        path.setAttribute('stroke-linecap', ['butt', 'round', 'square'][appearance.lineCap] ?? 'butt');
        path.setAttribute('stroke-linejoin', ['miter', 'round', 'bevel'][appearance.lineJoin] ?? 'miter');
        add(path);
      }
      return g.childElementCount > 0;
    };

    const g2 = a.geometry;
    // PDF appearance paths are authoritative for settled annotations, but they
    // still describe the pre-drag shape during a live edit. Build previews from
    // the changing geometry so ink, straight lines and arrows follow their
    // anchors immediately.
    if (
      !geometryPreview &&
      (a.subtype === 'ink' || a.subtype === 'polygon' || a.subtype === 'polyline') &&
      addAppearancePaths()
    ) {
      return g;
    }
    switch (g2.kind) {
      case 'ink': {
        const kind = inkStrokeKind(g2);
        const rounded = kind === 'curve';
        for (const strokePts of g2.strokes) {
          if (strokePts.length < 2) continue;
          const pl = document.createElementNS(SVG_NS, 'polyline');
          pl.setAttribute('points', strokePts.map((p) => offsetPair(toPx(p))).join(' '));
          pl.setAttribute('fill', 'none');
          pl.setAttribute('stroke', shapeStroke);
          pl.setAttribute('stroke-width', `${width}`);
          // PDFium renders authored straight lines/arrows with flat caps and a
          // sharp mitered arrow tip. Keep round joins only for freehand ink.
          pl.setAttribute('stroke-linejoin', rounded ? 'round' : 'miter');
          pl.setAttribute('stroke-linecap', rounded ? 'round' : 'butt');
          add(pl);
        }
        break;
      }
      case 'markup': {
        const markupStroke = a.subtype === 'underline' || a.subtype === 'strikeout';
        for (const q of g2.quads) {
          if (markupStroke) {
            // Underline/strikeout: a line across the quad.
            const yFrac = a.subtype === 'underline' ? 0.92 : 0.5;
            const left = toPx({ x: lerp(q.bottomLeft.x, q.topLeft.x, 0), y: lerp(q.bottomLeft.y, q.topLeft.y, yFrac) });
            const right = toPx({ x: q.bottomRight.x, y: lerp(q.bottomRight.y, q.topRight.y, yFrac) });
            const ln = document.createElementNS(SVG_NS, 'line');
            ln.setAttribute('x1', `${left.x}`);
            ln.setAttribute('y1', `${left.y}`);
            ln.setAttribute('x2', `${right.x}`);
            ln.setAttribute('y2', `${right.y}`);
            ln.setAttribute('stroke', stroke);
            ln.setAttribute('stroke-width', `${Math.max(width, 1)}`);
            add(ln);
          } else {
            const poly = document.createElementNS(SVG_NS, 'polygon');
            poly.setAttribute(
              'points',
              [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft].map((p) => offsetPair(toPx(p))).join(' '),
            );
            poly.setAttribute('fill', stroke);
            if (a.subtype !== 'highlight') {
              poly.setAttribute('fill-opacity', '0.25');
            }
            add(poly);
          }
        }
        break;
      }
      case 'line': {
        const s = toPx(g2.start);
        const e = toPx(g2.end);
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', `${s.x}`);
        ln.setAttribute('y1', `${s.y}`);
        ln.setAttribute('x2', `${e.x}`);
        ln.setAttribute('y2', `${e.y}`);
        ln.setAttribute('stroke', shapeStroke);
        ln.setAttribute('stroke-width', `${width}`);
        ln.setAttribute('stroke-linecap', 'round');
        add(ln);
        break;
      }
      case 'polygon':
      case 'polyline': {
        if (g2.vertices.length >= 2) {
          const el = document.createElementNS(SVG_NS, g2.kind === 'polygon' ? 'polygon' : 'polyline');
          el.setAttribute('points', g2.vertices.map((p) => offsetPair(toPx(p))).join(' '));
          el.setAttribute('fill', g2.kind === 'polygon' ? fill ?? 'none' : 'none');
          el.setAttribute('stroke', shapeStroke);
          el.setAttribute('stroke-width', `${width}`);
          add(el);
        }
        break;
      }
      default: {
        // Rect-defined subtypes (square, circle, freeText, text, stamp, …).
        const box = rectPx();
        if (a.subtype === 'circle') {
          // PDFium keeps the annotation rect as the outer painted bounds and
          // deflates the ellipse path by half the border width. SVG strokes are
          // centered on their path, so mirror that inset explicitly.
          const inset = width / 2;
          const ell = document.createElementNS(SVG_NS, 'ellipse');
          ell.setAttribute('cx', `${(box.left + box.right) / 2}`);
          ell.setAttribute('cy', `${(box.top + box.bottom) / 2}`);
          ell.setAttribute('rx', `${Math.max(0, Math.abs(rectWidth(box)) / 2 - inset)}`);
          ell.setAttribute('ry', `${Math.max(0, Math.abs(rectHeight(box)) / 2 - inset)}`);
          ell.setAttribute('fill', fill ?? 'none');
          ell.setAttribute('stroke', shapeStroke);
          ell.setAttribute('stroke-width', `${width}`);
          add(ell);
        } else if (a.subtype === 'text') {
          if (addAppearancePaths()) break;
          // PDFium's default Text-annotation appearance is a fixed yellow note
          // icon anchored four points below the annotation rect's top-left. It
          // ignores /C for the icon itself and adds a short downward tail.
          const x = box.left;
          // PDFium normalizes the loaded Text rect to the icon's painted top.
          const y = box.top;
          const tail = document.createElementNS(SVG_NS, 'path');
          tail.setAttribute('d', `M ${x + 4} ${y + 16} L ${x + 6} ${y + 20} L ${x + 8} ${y + 16} Z`);
          tail.setAttribute('fill', '#ffff00');
          tail.setAttribute('stroke', '#000');
          tail.setAttribute('stroke-width', '1');
          add(tail);
          const note = document.createElementNS(SVG_NS, 'rect');
          note.setAttribute('x', `${x + 0.5}`);
          note.setAttribute('y', `${y + 0.5}`);
          note.setAttribute('width', '19');
          note.setAttribute('height', '15');
          note.setAttribute('fill', '#ffff00');
          note.setAttribute('stroke', '#000');
          note.setAttribute('stroke-width', '1');
          add(note);
          for (const lineY of [y + 4, y + 8, y + 12]) {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', `${x + 3}`);
            line.setAttribute('x2', `${x + 17}`);
            line.setAttribute('y1', `${lineY + 0.5}`);
            line.setAttribute('y2', `${lineY + 0.5}`);
            line.setAttribute('stroke', '#000');
            line.setAttribute('stroke-width', '1');
            add(line);
          }
        } else if (a.subtype === 'stamp') {
          // Standard text stamps (Approved, Draft, …) are a rounded outline
          // with their /Contents label. A generic empty rectangle loses the
          // stamp's essential meaning when an existing PDF is loaded.
          if (!addAppearancePaths()) {
            const stampWidth = Math.max(width, 2);
            const inset = stampWidth / 2;
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', `${box.left + inset}`);
            rect.setAttribute('y', `${box.top + inset}`);
            rect.setAttribute('width', `${Math.max(0, rectWidth(box) - stampWidth)}`);
            rect.setAttribute('height', `${Math.max(0, rectHeight(box) - stampWidth)}`);
            rect.setAttribute('rx', `${Math.min(5, rectHeight(box) / 8)}`);
            rect.setAttribute('fill', 'none');
            rect.setAttribute('stroke', stroke);
            rect.setAttribute('stroke-width', `${stampWidth}`);
            add(rect);
          }
          if (a.contents) {
            const appearanceTextColor =
              a.appearanceTextStyles[0]?.fillColor ?? a.appearancePaths.find((path) => path.stroke)?.strokeColor;
            const text = document.createElementNS(SVG_NS, 'text');
            text.setAttribute('x', `${(box.left + box.right) / 2}`);
            text.setAttribute('y', `${(box.top + box.bottom) / 2}`);
            text.setAttribute('fill', colorCss(appearanceTextColor ?? a.color, '#000000') ?? '#000000');
            text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
            text.setAttribute('font-size', `${Math.max(8, rectHeight(box) * 0.5)}`);
            text.setAttribute('font-weight', '700');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.textContent = a.contents;
            add(text);
          }
        } else if (a.subtype === 'freeText') {
          // FreeText uses the normal shape style: /C is the border and /IC is
          // the box background. The worker builds the same custom /AP.
          // PDFium's ordinary FreeText appearance contains the fill and border
          // as two paths. A callout adds leader/arrow paths; keep those instead
          // of degrading the annotation to a plain text box.
          const hasCalloutAppearance = !a.appearanceLines && a.appearancePaths.length > 2;
          if (!hasCalloutAppearance || !addAppearancePaths()) {
            const rect = document.createElementNS(SVG_NS, 'rect');
            const inset = width / 2;
            rect.setAttribute('x', `${box.left + inset}`);
            rect.setAttribute('y', `${box.top + inset}`);
            rect.setAttribute('width', `${Math.max(0, Math.abs(rectWidth(box)) - width)}`);
            rect.setAttribute('height', `${Math.max(0, Math.abs(rectHeight(box)) - width)}`);
            rect.setAttribute('fill', fill ?? 'none');
            rect.setAttribute('stroke', shapeStroke);
            rect.setAttribute('stroke-width', `${width}`);
            add(rect);
          }
          if (a.contents) {
            const appearanceText = hasCalloutAppearance ? a.appearanceTextStyles[0] : undefined;
            const appearanceOrigin = appearanceText ? toPx(appearanceText.origin) : null;
            const fontSize = appearanceText?.fontSize || FREE_TEXT_FONT_SIZE;
            const clipId = `pdfrx-free-text-${a.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            const clipPath = document.createElementNS(SVG_NS, 'clipPath');
            clipPath.setAttribute('id', clipId);
            const clipRect = document.createElementNS(SVG_NS, 'rect');
            clipRect.setAttribute('x', `${box.left + width + FREE_TEXT_PADDING}`);
            clipRect.setAttribute('y', `${box.top + width + FREE_TEXT_PADDING}`);
            clipRect.setAttribute('width', `${Math.max(0, rectWidth(box) - width * 2 - FREE_TEXT_PADDING * 2)}`);
            clipRect.setAttribute('height', `${Math.max(0, rectHeight(box) - width * 2 - FREE_TEXT_PADDING * 2)}`);
            clipPath.appendChild(clipRect);
            add(clipPath);
            const text = document.createElementNS(SVG_NS, 'text');
            const textX = appearanceOrigin?.x ?? box.left + width + FREE_TEXT_PADDING;
            const textY = appearanceOrigin?.y ?? box.top + width + FREE_TEXT_PADDING + fontSize;
            text.setAttribute('x', `${textX}`);
            text.setAttribute('y', `${textY}`);
            text.setAttribute('fill', colorCss(appearanceText?.fillColor ?? null, '#000') ?? '#000');
            text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
            text.setAttribute('font-size', `${fontSize}`);
            text.setAttribute('clip-path', `url(#${clipId})`);
            const lines = a.appearanceLines ?? wrapFreeText(a.contents, rectWidth(box) - width * 2, fontSize);
            lines.forEach((line, index) => {
              const tspan = document.createElementNS(SVG_NS, 'tspan');
              tspan.setAttribute('x', `${textX}`);
              tspan.setAttribute('y', `${textY + index * (fontSize * 1.2)}`);
              tspan.textContent = line || '\u00a0';
              text.appendChild(tspan);
            });
            add(text);
          }
        } else {
          const inset = a.subtype === 'square' ? width / 2 : 0;
          const rect = document.createElementNS(SVG_NS, 'rect');
          rect.setAttribute('x', `${box.left + inset}`);
          rect.setAttribute('y', `${box.top + inset}`);
          rect.setAttribute('width', `${Math.max(0, Math.abs(rectWidth(box)) - inset * 2)}`);
          rect.setAttribute('height', `${Math.max(0, Math.abs(rectHeight(box)) - inset * 2)}`);
          rect.setAttribute('fill', fill ?? 'none');
          rect.setAttribute('stroke', shapeStroke);
          rect.setAttribute('stroke-width', `${width}`);
          add(rect);
        }
      }
    }
    return g.childElementCount ? g : null;
  }

  /** Reloads/repaints annotation overlays on the affected pages after a change. */
  private onAnnotationsChanged(): void {
    // Keep the current SVGs on screen while fresh annotation data is loaded.
    // updateAnnotationOverlays replaces each affected page synchronously once
    // its replacement is ready, avoiding an empty frame between old and new.
    this.annotationReloadGeneration++;
    this.pageAnnotations.clear();
    for (const pageNumber of this.annotationOverlays.keys()) this.dirtyAnnotationOverlayPages.add(pageNumber);
    this.invalidate();
  }

  /** Removes all annotation overlays. */
  private clearAnnotationOverlays(): void {
    this.annotationOverlayRoot.replaceChildren();
    this.annotationOverlays.clear();
    this.dirtyAnnotationOverlayPages.clear();
    this.drawState = null;
  }

  // -------------------------------------------------------------------------
  // Annotation editing (drawing tools, selection, move, delete).
  // -------------------------------------------------------------------------

  /**
   * Selects a drawing tool (or `null` for idle/viewing). While a drawing tool is
   * active the annotation overlay captures pointer drags to create annotations.
   * Setting a tool leaves select mode. Requires `interactiveAnnotations`.
   */
  setAnnotationTool(tool: AnnotationTool | null): void {
    if (tool) this.setSelectedAnnotations([]);
    this.setAnnotationMode(tool);
  }

  /** The active drawing tool, or null (idle or select mode). */
  getAnnotationTool(): AnnotationTool | null {
    return this.annotationMode === 'select' ? null : this.annotationMode;
  }

  /**
   * Enters (or leaves) annotation *select* mode: dragging on empty page area
   * rubber-band-selects every overlapping annotation, and a multi-selection can
   * be moved/resized as a group. Annotation selection and editing are disabled
   * outside this mode, leaving annotations display-only during normal viewing.
   */
  setAnnotationSelectMode(on: boolean): void {
    this.setAnnotationMode(on ? 'select' : null);
  }

  /** Current annotation interaction mode. */
  getAnnotationMode(): AnnotationMode {
    return this.annotationMode;
  }

  /** Subscribes to annotation interaction-mode changes. */
  addAnnotationModeChangeListener(listener: (mode: AnnotationMode) => void): () => void {
    this.annotationModeChangeListeners.add(listener);
    return () => this.annotationModeChangeListeners.delete(listener);
  }

  private setAnnotationMode(mode: AnnotationMode): void {
    if (mode === this.annotationMode) return;
    if (mode !== 'select') this.setSelectedAnnotations([]);
    this.annotationMode = mode;
    this.invalidate();
    for (const listener of this.annotationModeChangeListeners) {
      try {
        listener(mode);
      } catch (e) {
        console.error('Error in annotation mode change listener:', e);
      }
    }
  }

  /** Whether annotation select mode is active. */
  isAnnotationSelectMode(): boolean {
    return this.annotationMode === 'select';
  }

  /** The active drawing tool, or null. @internal */
  private drawingTool(): AnnotationTool | null {
    return this.annotationMode === 'select' ? null : this.annotationMode;
  }

  /** Updates the style applied to newly drawn annotations. */
  setAnnotationStyle(style: Partial<AnnotationStyle>): void {
    this.annotationStyle = { ...this.annotationStyle, ...style };
  }

  /** The current annotation drawing style. */
  getAnnotationStyle(): AnnotationStyle {
    return { ...this.annotationStyle };
  }

  /**
   * Applies a `color` and/or `strokeWidth` to every currently selected annotation
   * as one undoable step. No-op when nothing is selected. Use alongside
   * {@link setAnnotationStyle} (which only affects newly drawn annotations).
   */
  async applyStyleToSelection(style: Partial<AnnotationStyle>, historyMergeKey?: string): Promise<void> {
    if (!this.doc || this.selectedAnnotationIds.size === 0) return;
    const { color, opacity, fillColor, strokeWidth } = style;
    if (
      color === undefined &&
      opacity === undefined &&
      fillColor === undefined &&
      strokeWidth === undefined
    ) {
      return;
    }
    const stroke = color !== undefined ? cssColorToRgba(color, opacity ?? this.annotationStyle.opacity) : undefined;
    // `fillColor` is tri-state: undefined = leave, null = clear the fill, string = set it.
    const fill =
      fillColor === undefined
        ? undefined
        : fillColor === null
          ? null
          : cssColorToRgba(fillColor, opacity ?? this.annotationStyle.opacity);
    const toAlpha = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
    const targets = [...this.selectedAnnotationIds]
      .map((id) => this.locateAnnotation(id))
      .filter((t): t is { pageNumber: number; annotation: PdfAnnotationObject } => t !== null);
    const group: AnnotationCommand[] = [];
    for (const t of targets) {
      const before = annotationToSpec(t.annotation);
      const after = annotationToSpec(t.annotation);
      if (stroke) after.color = stroke;
      // Opacity belongs to the annotation as a whole. Re-alpha both authored
      // colors so the SVG overlay and PDFium's single /CA value agree.
      else if (opacity !== undefined && after.color) after.color = { ...after.color, a: toAlpha(opacity) };
      if (fill !== undefined) after.interiorColor = fill;
      else if (opacity !== undefined && after.interiorColor) {
        after.interiorColor = { ...after.interiorColor, a: toAlpha(opacity) };
      }
      if (strokeWidth !== undefined) after.borderWidth = strokeWidth;
      refreshFreeTextLayout(after);
      group.push({ pageNumber: t.pageNumber, id: t.annotation.id, before, after });
    }
    if (group.length === 0) return;
    const generation =
      historyMergeKey === undefined ? 0 : (this.annotationStyleLatestGeneration.get(historyMergeKey) ?? 0) + 1;
    if (historyMergeKey !== undefined) this.annotationStyleLatestGeneration.set(historyMergeKey, generation);
    const update = async (): Promise<void> => {
      // One write may already be in flight. Of the writes waiting behind it for
      // this slider gesture, only apply the most recent value.
      if (
        historyMergeKey !== undefined &&
        this.annotationStyleLatestGeneration.get(historyMergeKey) !== generation
      ) {
        return;
      }
      try {
        if (!this.doc) return;
        for (const cmd of group) {
          const after = cmd.after!;
          if (after.subtype === 'freeText') await this.prepareFreeTextAppearance(after);
          await this.doc.updateAnnotation(cmd.pageNumber, cmd.id, after);
          const snapshot = this.annotationSnapshots.get(cmd.id);
          if (snapshot) {
            this.annotationSnapshots.set(cmd.id, {
              pageNumber: cmd.pageNumber,
              annotation: syntheticAnnotation(snapshot.annotation, after),
            });
          }
        }
        this.recordAnnotationCommandGroup(group, historyMergeKey);
      } finally {
        if (
          historyMergeKey !== undefined &&
          this.annotationStyleLatestGeneration.get(historyMergeKey) === generation
        ) {
          this.annotationStyleLatestGeneration.delete(historyMergeKey);
        }
      }
    };
    const pending = this.annotationStyleUpdateQueue.then(update, update);
    this.annotationStyleUpdateQueue = pending.catch(() => undefined);
    await pending;
  }

  /** The id of the first selected annotation, or null. */
  getSelectedAnnotationId(): string | null {
    for (const id of this.selectedAnnotationIds) return id;
    return null;
  }

  /** The ids of all currently selected annotations. */
  getSelectedAnnotationIds(): string[] {
    return [...this.selectedAnnotationIds];
  }

  /** Selects (highlights) a single annotation by id, or clears with `null`. */
  setSelectedAnnotation(id: string | null): void {
    this.setSelectedAnnotations(id ? [id] : []);
  }

  /** Replaces the selection with `ids` and redraws anchor handles. */
  setSelectedAnnotations(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === this.selectedAnnotationIds.size && [...next].every((id) => this.selectedAnnotationIds.has(id))) {
      return;
    }
    this.selectedAnnotationIds.clear();
    for (const id of next) this.selectedAnnotationIds.add(id);
    this.refreshAnnotationSelectionAll();
  }

  /**
   * Selects every annotation on one page. Defaults to the page occupying the
   * largest visible area, matching {@link currentPageNumber}.
   */
  async selectAllAnnotationsOnPage(pageNumber: number | null = this.currentPageNumber): Promise<boolean> {
    if (!this.doc || pageNumber === null || pageNumber < 1 || pageNumber > this.doc.pages.length) return false;
    const annotations = await this.doc.pages[pageNumber - 1]!.loadAnnotations();
    this.setSelectedAnnotations(annotations.map((annotation) => annotation.id));
    return annotations.length > 0;
  }

  /**
   * Highlights the current text selection: adds a `Highlight` markup annotation
   * per page from the selected text's line rectangles (quadpoints), as one
   * undoable step, then clears the text selection. No-op without a selection.
   * `color` defaults to the current annotation drawing color.
   */
  async highlightSelection(
    color: string = this.annotationStyle.color,
    opacity: number = this.annotationStyle.opacity,
  ): Promise<void> {
    if (!this.doc || !this.selA || !this.selB) return;
    const rgba = cssColorToRgba(color, opacity);
    const ranges = getSelectedRanges(this.selA, this.selB, (n) => this.getLoadedText(n));
    const group: AnnotationCommand[] = [];
    for (const range of ranges) {
      const quads: PdfAnnotationQuad[] = [];
      for (const fr of enumerateFragmentBoundingRects({ pageText: range.pageText, start: range.start, end: range.end })) {
        const b = fr.bounds; // bbox-relative PDF page coords (y-up, top >= bottom)
        quads.push({
          topLeft: { x: b.left, y: b.top },
          topRight: { x: b.right, y: b.top },
          bottomLeft: { x: b.left, y: b.bottom },
          bottomRight: { x: b.right, y: b.bottom },
        });
      }
      if (quads.length === 0) continue;
      const pageNumber = range.pageText.pageNumber;
      const rect = bboxOfPoints(quads.flatMap((q) => [q.topLeft, q.topRight, q.bottomLeft, q.bottomRight]));
      const spec: PdfAnnotationSpec = { subtype: 'highlight', rect, color: rgba, geometry: { kind: 'markup', quads } };
      const id = await this.doc.addAnnotation(pageNumber, spec);
      group.push({ pageNumber, id, before: null, after: spec });
    }
    this.recordAnnotationCommandGroup(group);
    this.clearSelection();
  }

  /** Whether the current text selection can be highlighted (has a selection + annotations on). */
  canHighlightSelection(): boolean {
    return this.options.interactiveAnnotations !== false && !!(this.selA && this.selB);
  }

  /** Copies the selected annotations to the viewer-local object clipboard. */
  copySelectedAnnotations(): boolean {
    const entries = [...this.selectedAnnotationIds]
      .map((id) => this.locateAnnotation(id))
      .filter((t): t is { pageNumber: number; annotation: PdfAnnotationObject } => t !== null)
      .map((t) => ({ pageNumber: t.pageNumber, spec: annotationToSpec(t.annotation) }));
    if (entries.length === 0) return false;
    this.annotationClipboard = entries;
    this.annotationClipboardPasteCount = 0;
    this.annotationClipboardWasCut = false;
    return true;
  }

  /** Cuts the selected annotations as one undoable delete operation. */
  async cutSelectedAnnotations(): Promise<boolean> {
    if (!this.copySelectedAnnotations()) return false;
    this.annotationClipboardWasCut = true;
    await this.deleteSelectedAnnotation();
    return true;
  }

  /**
   * Pastes the object clipboard and selects the newly created annotations.
   * Copy/paste offsets each generation by 10pt; the first paste after a cut
   * retains the original position. A multi-object paste is one undo step.
   */
  async pasteAnnotations(): Promise<boolean> {
    if (!this.doc || this.annotationClipboard.length === 0) return false;
    let pasted = false;
    const paste = async (): Promise<void> => {
      if (!this.doc) return;
      const nextCount = this.annotationClipboardPasteCount + 1;
      const offsetSteps = this.annotationClipboardWasCut ? nextCount - 1 : nextCount;
      const offset = offsetSteps * 10;
      const group: AnnotationCommand[] = [];
      const ids: string[] = [];
      for (const entry of this.annotationClipboard) {
        if (entry.pageNumber < 1 || entry.pageNumber > this.doc.pages.length) continue;
        const spec = translateSpec(entry.spec, offset, -offset);
        const id = await this.doc.addAnnotation(entry.pageNumber, spec);
        group.push({ pageNumber: entry.pageNumber, id, before: null, after: spec });
        ids.push(id);
      }
      if (group.length === 0) return;
      this.annotationClipboardPasteCount = nextCount;
      this.recordAnnotationCommandGroup(group);
      this.setAnnotationSelectMode(true);
      this.setSelectedAnnotations(ids);
      pasted = true;
    };
    const pending = this.annotationPasteQueue.then(paste, paste);
    this.annotationPasteQueue = pending.catch(() => undefined);
    await pending;
    return pasted;
  }

  /** Removes every selected annotation as one undoable step. */
  async deleteSelectedAnnotation(): Promise<void> {
    if (!this.doc || this.selectedAnnotationIds.size === 0) return;
    const targets = [...this.selectedAnnotationIds]
      .map((id) => this.locateAnnotation(id))
      .filter((t): t is { pageNumber: number; annotation: PdfAnnotationObject } => t !== null);
    if (targets.length === 0) return;
    this.selectedAnnotationIds.clear();
    const group: AnnotationCommand[] = [];
    for (const t of targets) {
      const before = annotationToSpec(t.annotation);
      await this.doc.removeAnnotation(t.pageNumber, t.annotation.id);
      group.push({ pageNumber: t.pageNumber, id: t.annotation.id, before, after: null });
    }
    this.recordAnnotationCommandGroup(group);
  }

  /** Finds the page number and last known object of an annotation by id. */
  private locateAnnotation(id: string): { pageNumber: number; annotation: PdfAnnotationObject } | null {
    for (const [pageNumber, overlay] of this.annotationOverlays) {
      const annotation = overlay.annotations.get(id);
      if (annotation) return { pageNumber, annotation };
    }
    return this.annotationSnapshots.get(id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Annotation undo / redo.
  // -------------------------------------------------------------------------

  /** Records a single-command edit as its own undo step. */
  private recordAnnotationCommand(cmd: AnnotationCommand): void {
    this.recordAnnotationCommandGroup([cmd]);
  }

  /** Records a group of commands as one atomic undo step (skips empty groups). */
  private recordAnnotationCommandGroup(group: AnnotationCommand[], mergeKey?: string): void {
    if (group.length === 0) return;
    if (
      mergeKey !== undefined &&
      mergeKey === this.annotationHistoryMergeKey &&
      this.historyIndex === this.history.length &&
      this.historyIndex > 0 &&
      this.history[this.historyIndex - 1]?.kind === 'annotations'
    ) {
      const previous = this.history[this.historyIndex - 1]!;
      if (previous.kind !== 'annotations') return; // narrowed by the condition above
      const previousById = new Map(previous.commands.map((cmd) => [`${cmd.pageNumber}:${cmd.id}`, cmd]));
      previous.commands = group.map((cmd) => {
        const first = previousById.get(`${cmd.pageNumber}:${cmd.id}`);
        return first ? { ...cmd, before: first.before } : cmd;
      });
      this.notifyHistoryChanged();
      return;
    }
    this.recordHistoryEntry({ kind: 'annotations', commands: group });
    this.annotationHistoryMergeKey = mergeKey ?? null;
  }

  private recordHistoryEntry(entry: HistoryEntry): void {
    this.history.length = this.historyIndex;
    this.history.push(entry);
    this.historyIndex++;
    this.notifyHistoryChanged();
  }

  private notifyHistoryChanged(): void {
    for (const listener of this.historyChangeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in history change listener:', e);
      }
    }
  }

  /** Subscribes to changes in the common annotation/page-edit history. */
  addHistoryChangeListener(listener: () => void): () => void {
    this.historyChangeListeners.add(listener);
    return () => this.historyChangeListeners.delete(listener);
  }

  /** Clears all Undo/Redo entries without changing the document. */
  clearHistory(): void {
    this.history = [];
    this.historyIndex = 0;
    this.annotationHistoryMergeKey = null;
    this.notifyHistoryChanged();
  }

  /** Whether an annotation or page edit can be undone. */
  canUndo(): boolean {
    return this.historyIndex > 0;
  }

  /** Whether an undone annotation or page edit can be redone. */
  canRedo(): boolean {
    return this.historyIndex < this.history.length;
  }

  /** Backwards-compatible alias for {@link canUndo}. */
  canUndoAnnotation(): boolean {
    return this.canUndo();
  }

  /** Backwards-compatible alias for {@link canRedo}. */
  canRedoAnnotation(): boolean {
    return this.canRedo();
  }

  /** Undoes the latest annotation or page edit. */
  async undo(): Promise<void> {
    if (!this.canUndo()) return;
    const entry = this.history[--this.historyIndex]!;
    this.setSelectedAnnotations([]);
    if (entry.kind === 'pages') {
      this.doc?.setPages(entry.before);
    } else {
      for (let i = entry.commands.length - 1; i >= 0; i--) {
        const cmd = entry.commands[i]!;
        await this.applyAnnotationState(cmd.pageNumber, cmd.id, cmd.before);
      }
    }
    this.annotationHistoryMergeKey = null;
    this.notifyHistoryChanged();
  }

  /** Redoes the next undone annotation or page edit. */
  async redo(): Promise<void> {
    if (!this.canRedo()) return;
    const entry = this.history[this.historyIndex++]!;
    this.setSelectedAnnotations([]);
    if (entry.kind === 'pages') {
      this.doc?.setPages(entry.after);
    } else {
      for (const cmd of entry.commands) await this.applyAnnotationState(cmd.pageNumber, cmd.id, cmd.after);
    }
    this.annotationHistoryMergeKey = null;
    this.notifyHistoryChanged();
  }

  /** Backwards-compatible alias for {@link undo}. */
  async undoAnnotation(): Promise<void> {
    await this.undo();
  }

  /** Backwards-compatible alias for {@link redo}. */
  async redoAnnotation(): Promise<void> {
    await this.redo();
  }

  /** Replaces the page arrangement and records it as one undoable edit. */
  setPages(pages: readonly PdfPage[]): void {
    if (!this.doc) return;
    const before = this.doc.pages.slice();
    if (
      before.length === pages.length &&
      before.every((page, index) => page.renderKey === pages[index]?.renderKey)
    ) return;
    this.doc.setPages(pages);
    this.recordHistoryEntry({ kind: 'pages', before, after: this.doc.pages.slice() });
    this.annotationHistoryMergeKey = null;
  }

  /** Replaces one page slot and records it as one undoable edit. */
  setPage(pageNumber: number, page: PdfPage): void {
    if (!this.doc) return;
    if (pageNumber < 1 || pageNumber > this.doc.pages.length) {
      throw new RangeError(`pageNumber ${pageNumber} out of range (1..${this.doc.pages.length})`);
    }
    const pages = this.doc.pages.slice();
    pages[pageNumber - 1] = page;
    this.setPages(pages);
  }

  /**
   * Drives the document to a target annotation state without touching the
   * history: `null` removes the annotation, a spec creates/replaces it by id.
   */
  private async applyAnnotationState(pageNumber: number, id: string, spec: PdfAnnotationSpec | null): Promise<void> {
    if (!this.doc) return;
    this.selectedAnnotationIds.delete(id);
    if (spec === null) await this.doc.removeAnnotation(pageNumber, id);
    else await this.doc.updateAnnotation(pageNumber, id, spec);
  }

  /** Re-applies the selection outline + anchor handles across every overlay. */
  private refreshAnnotationSelectionAll(): void {
    for (const overlay of this.annotationOverlays.values()) this.refreshAnnotationSelection(overlay);
  }

  /** The selected annotations that live on this overlay's page. */
  private selectedAnnotationsOn(overlay: AnnotationPageOverlay): PdfAnnotationObject[] {
    const out: PdfAnnotationObject[] = [];
    for (const id of this.selectedAnnotationIds) {
      const a = overlay.annotations.get(id);
      if (a) out.push(a);
    }
    return out;
  }

  /**
   * Draws the selection's draggable anchor handles (the sole indication of
   * selection): a single annotation gets its own shape handles; a multi-selection
   * gets one group bounding box that moves/scales every member together.
   */
  private refreshAnnotationSelection(overlay: AnnotationPageOverlay): void {
    overlay.anchorLayer.replaceChildren();
    // Outline every selected shape so a multi-selection is visible around the box.
    const multi = this.selectedAnnotationIds.size > 1;
    for (const child of Array.from(overlay.svg.children)) {
      const g = child as SVGGElement;
      if (!g.dataset.annotId) continue;
      const selected = this.selectedAnnotationIds.has(g.dataset.annotId);
      const annotation = overlay.annotations.get(g.dataset.annotId);
      // Once selected, let the complete annotation bounds start a move. Touch
      // users can therefore drag from the interior/empty part of a shape rather
      // than having to hit its painted stroke again. Unselected annotations keep
      // their precise hit testing so overlapping objects remain distinguishable.
      g.style.pointerEvents = selected || annotation?.subtype === 'freeText' ? 'bounding-box' : 'auto';
      g.style.filter = multi && selected ? 'drop-shadow(0 0 2px #2196f3)' : '';
    }
    const sel = this.selectedAnnotationsOn(overlay);
    if (sel.length === 1) this.renderAnnotationAnchors(overlay, sel[0]!);
    else if (sel.length > 1) this.renderGroupSelection(overlay, sel);
  }

  /** Finger-friendly anchors after a touch selection; compact anchors for mouse/pen. */
  private annotationAnchorScreenPx(): number {
    return this.lastPointerType === 'touch' ? TOUCH_ANCHOR_SCREEN_PX : ANCHOR_SCREEN_PX;
  }

  /**
   * Draws a single blue guide box with eight handles around a multi-selection;
   * dragging a handle scales every member, dragging the box body moves them all.
   */
  private renderGroupSelection(overlay: AnnotationPageOverlay, sel: PdfAnnotationObject[]): void {
    const zoom = this.transform.zoom;
    const b = unionBounds(sel.map((a) => annotationBounds(a)));
    const opts = { page: overlay.pageGeom, scaledPageSize: overlay.pageSize };
    const tl = pdfPointToOffset({ x: b.left, y: b.top }, opts);
    const br = pdfPointToOffset({ x: b.right, y: b.bottom }, opts);
    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('x', `${Math.min(tl.x, br.x)}`);
    box.setAttribute('y', `${Math.min(tl.y, br.y)}`);
    box.setAttribute('width', `${Math.abs(br.x - tl.x)}`);
    box.setAttribute('height', `${Math.abs(br.y - tl.y)}`);
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', '#2196f3');
    box.setAttribute('stroke-opacity', '0.9');
    box.setAttribute('stroke-width', `${1 / zoom}`);
    box.setAttribute('stroke-dasharray', `${4 / zoom} ${3 / zoom}`);
    box.style.pointerEvents = 'none';
    overlay.anchorLayer.appendChild(box);
    // Eight scaling handles around the group box.
    const r = this.annotationAnchorScreenPx() / 2 / zoom;
    boundingBoxHandlePoints(b).forEach((pt, index) => {
      const px = pdfPointToOffset(pt, opts);
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', `${px.x}`);
      c.setAttribute('cy', `${px.y}`);
      c.setAttribute('r', `${r}`);
      c.setAttribute('fill', '#fff');
      c.setAttribute('stroke', '#2196f3');
      c.setAttribute('stroke-width', `${1.5 / zoom}`);
      c.style.pointerEvents = 'auto';
      c.style.cursor = 'grab';
      c.addEventListener('pointerdown', (e) => {
        if (!this.isAnnotationSelectMode() || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.beginGroupResize(overlay, sel, b, index, c, e.pointerId);
      });
      overlay.anchorLayer.appendChild(c);
    });
  }

  /** Draws a draggable circle for each control point of the selected annotation. */
  private renderAnnotationAnchors(overlay: AnnotationPageOverlay, annotation: PdfAnnotationObject): void {
    const anchors = annotationAnchors(annotation);
    // The overlay is scaled by zoom, so divide by it to keep a constant on-screen
    // handle size regardless of zoom (updateAnnotationOverlays keeps it in sync).
    const zoom = this.transform.zoom;
    const r = this.annotationAnchorScreenPx() / 2 / zoom;
    // A dashed bounding rectangle guides scaling of shapes whose bounds are not
    // already obvious from the shape (freehand pen, ellipse — not a rectangle,
    // not line/arrow).
    if (annotationShowsBoundingBox(annotation)) {
      const b = annotationBounds(annotation);
      const tl = pdfPointToOffset({ x: b.left, y: b.top }, { page: overlay.pageGeom, scaledPageSize: overlay.pageSize });
      const br = pdfPointToOffset({ x: b.right, y: b.bottom }, { page: overlay.pageGeom, scaledPageSize: overlay.pageSize });
      const box = document.createElementNS(SVG_NS, 'rect');
      box.setAttribute('x', `${Math.min(tl.x, br.x)}`);
      box.setAttribute('y', `${Math.min(tl.y, br.y)}`);
      box.setAttribute('width', `${Math.abs(br.x - tl.x)}`);
      box.setAttribute('height', `${Math.abs(br.y - tl.y)}`);
      box.setAttribute('fill', 'none');
      box.setAttribute('stroke', '#2196f3');
      box.setAttribute('stroke-opacity', '0.9');
      box.setAttribute('stroke-width', `${1 / zoom}`);
      box.setAttribute('stroke-dasharray', `${4 / zoom} ${3 / zoom}`);
      box.style.pointerEvents = 'none';
      overlay.anchorLayer.appendChild(box);
    }
    anchors.forEach((anchor, index) => {
      const px = pdfPointToOffset(anchor.point, { page: overlay.pageGeom, scaledPageSize: overlay.pageSize });
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', `${px.x}`);
      c.setAttribute('cy', `${px.y}`);
      c.setAttribute('r', `${r}`);
      c.setAttribute('fill', '#fff');
      c.setAttribute('stroke', '#2196f3');
      c.setAttribute('stroke-width', `${1.5 / this.transform.zoom}`);
      c.style.pointerEvents = 'auto';
      c.style.cursor = 'grab';
      c.addEventListener('pointerdown', (e) => {
        if (!this.isAnnotationSelectMode() || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.beginAnchorDrag(overlay, annotation, index, c, e.pointerId);
      });
      overlay.anchorLayer.appendChild(c);
    });
  }

  /** Drags one anchor (control point), reshaping just that point, then commits. */
  private beginAnchorDrag(
    overlay: AnnotationPageOverlay,
    annotation: PdfAnnotationObject,
    index: number,
    circle: SVGCircleElement,
    pointerId: number,
  ): void {
    const anchor = annotationAnchors(annotation)[index];
    if (!anchor) return;
    try {
      circle.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    circle.style.cursor = 'grabbing';
    let lastSpec: PdfAnnotationSpec | null = null;
    const move = (e: PointerEvent): void => {
      const px = this.clientToPagePx(overlay.svg, e.clientX, e.clientY);
      const to = offsetToPdfPoint(px, { page: overlay.pageGeom, scaledPageSize: overlay.pageSize });
      lastSpec = anchor.reshape(to);
      const display = syntheticAnnotation(annotation, lastSpec);
      this.previewAnnotationShape(overlay, annotation, lastSpec);
      // Move every anchor (and the bounding box) to follow the reshaped geometry.
      this.updateAnchorPositions(overlay, display);
    };
    const up = (): void => {
      circle.removeEventListener('pointermove', move);
      circle.removeEventListener('pointerup', up);
      circle.removeEventListener('pointercancel', up);
      circle.style.cursor = 'grab';
      if (!lastSpec || !this.doc) return;
      const before = annotationToSpec(annotation);
      const after = lastSpec;
      refreshFreeTextLayout(after);
      void (async () => {
        if (after.subtype === 'freeText') await this.prepareFreeTextAppearance(after);
        await this.doc!.updateAnnotation(overlay.pageNumber, annotation.id, after);
        this.recordAnnotationCommand({ pageNumber: overlay.pageNumber, id: annotation.id, before, after });
      })();
    };
    circle.addEventListener('pointermove', move);
    circle.addEventListener('pointerup', up);
    circle.addEventListener('pointercancel', up);
  }

  /** Replaces the selected annotation's shape with a live preview from `spec`. */
  private previewAnnotationShape(overlay: AnnotationPageOverlay, base: PdfAnnotationObject, spec: PdfAnnotationSpec): void {
    const old = Array.from(overlay.svg.children).find(
      (c) => (c as SVGGElement).dataset?.annotId === base.id,
    ) as SVGGElement | undefined;
    if (!old) return;
    const fresh = this.buildAnnotationShape(syntheticAnnotation(base, spec), overlay.pageGeom, overlay.pageSize, true);
    if (!fresh) return;
    fresh.dataset.annotId = base.id;
    fresh.style.pointerEvents = 'auto';
    if (base.subtype === 'highlight') {
      const visual = overlay.highlightSvg.querySelector<SVGGElement>(`g[data-annot-visual-id="${CSS.escape(base.id)}"]`);
      if (visual) {
        const visualFresh = fresh.cloneNode(true) as SVGGElement;
        visualFresh.removeAttribute('data-annot-id');
        visualFresh.dataset.annotVisualId = base.id;
        visualFresh.style.pointerEvents = 'none';
        overlay.highlightSvg.replaceChild(visualFresh, visual);
      }
      fresh.style.opacity = '0';
    }
    overlay.svg.replaceChild(fresh, old);
  }

  /** Visible shape for an id (highlights paint on their separate blend layer). */
  private annotationDisplayGroup(overlay: AnnotationPageOverlay, id: string, fallback: SVGGElement): SVGGElement {
    return (
      overlay.highlightSvg.querySelector<SVGGElement>(`g[data-annot-visual-id="${CSS.escape(id)}"]`) ?? fallback
    );
  }

  /**
   * Moves the existing anchor circles (and the bounding-box guide) to match
   * `annotation` in place — used during a live resize so every handle follows,
   * not just the dragged one. Does not rebuild the DOM (preserves pointer capture).
   */
  private updateAnchorPositions(overlay: AnnotationPageOverlay, annotation: PdfAnnotationObject): void {
    const opts = { page: overlay.pageGeom, scaledPageSize: overlay.pageSize };
    const anchors = annotationAnchors(annotation);
    const circles = overlay.anchorLayer.querySelectorAll('circle');
    anchors.forEach((a, i) => {
      const c = circles[i];
      if (!c) return;
      const px = pdfPointToOffset(a.point, opts);
      c.setAttribute('cx', `${px.x}`);
      c.setAttribute('cy', `${px.y}`);
    });
    const box = overlay.anchorLayer.querySelector('rect');
    if (box) {
      const b = annotationBounds(annotation);
      const tl = pdfPointToOffset({ x: b.left, y: b.top }, opts);
      const br = pdfPointToOffset({ x: b.right, y: b.bottom }, opts);
      box.setAttribute('x', `${Math.min(tl.x, br.x)}`);
      box.setAttribute('y', `${Math.min(tl.y, br.y)}`);
      box.setAttribute('width', `${Math.abs(br.x - tl.x)}`);
      box.setAttribute('height', `${Math.abs(br.y - tl.y)}`);
    }
  }

  /** Wires pointer editing onto a freshly built page overlay. */
  private attachAnnotationEditing(overlay: AnnotationPageOverlay, pageNumber: number, pageGeom: PageGeometry, pageSize: Size): void {
    const svg = overlay.svg;
    // Any pointerdown within the overlay (shape / anchor / marquee) focuses the
    // canvas so its keyboard shortcuts (Delete to remove the selection, undo/redo)
    // work — the shapes' stopPropagation otherwise keeps focus away in capture-off
    // handlers, so this runs in the capture phase, before them.
    svg.addEventListener(
      'pointerdown',
      (event) => {
        // The inline Text/FreeText editor lives inside this SVG. Its own
        // pointerdown handler cannot prevent a capture-phase focus change here,
        // and focusing the canvas blurs (and therefore closes) the editor before
        // the user can place the caret or drag its resize handle.
        if (event.target instanceof Element && event.target.closest('.pdfrx-annotation-text-editor')) return;
        this.canvas.focus({ preventScroll: true });
      },
      true,
    );
    // On the SVG surface (empty page area, since shapes stop propagation): draw
    // when a tool is active, rubber-band-select in select mode.
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.lastPointerType = e.pointerType;
      const start = this.clientToPagePx(svg, e.clientX, e.clientY);
      if (this.drawingTool()) {
        e.preventDefault();
        e.stopPropagation();
        this.beginDraw(pageNumber, overlay, pageGeom, pageSize, start, e.pointerId);
      } else if (this.isAnnotationSelectMode()) {
        e.preventDefault();
        e.stopPropagation();
        this.beginMarquee(overlay, start, e.pointerId);
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!this.drawState || this.drawState.svg !== svg) return;
      this.updateDraw(this.clientToPagePx(svg, e.clientX, e.clientY));
    });
    const finish = (e: PointerEvent): void => {
      if (!this.drawState || this.drawState.svg !== svg) return;
      this.trackAnnotationTextEdit(this.commitDraw(overlay, this.clientToPagePx(svg, e.clientX, e.clientY)));
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);
    // Selection + move: per-shape, so empty areas still pan/select text.
    for (const child of Array.from(svg.children)) {
      const g = child as SVGGElement;
      const id = g.dataset.annotId;
      if (!id) continue;
      // Select mode makes shapes interactive while normal viewing leaves them
      // click-through (synchronized by updateAnnotationOverlays).
      const annotation = overlay.annotations.get(id);
      // An unfilled FreeText box otherwise only receives events on its glyphs
      // and stroke. Treat its complete rectangular bounds as the hit target.
      g.style.pointerEvents = annotation?.subtype === 'freeText' ? 'bounding-box' : 'auto';
      g.style.cursor = this.isAnnotationSelectMode() ? 'pointer' : '';
      g.addEventListener('pointerdown', (e) => {
        if (!this.isAnnotationSelectMode() || e.button !== 0) return;
        this.lastPointerType = e.pointerType;
        e.preventDefault();
        e.stopPropagation();
        const start = this.clientToPagePx(svg, e.clientX, e.clientY);
        // Dragging a member of a multi-selection moves the whole group; otherwise
        // select just this shape and move it.
        if (this.selectedAnnotationIds.size > 1 && this.selectedAnnotationIds.has(id)) {
          this.beginGroupMove(
            overlay,
            this.selectedAnnotationsOn(overlay),
            start,
            e.pointerId,
            e.shiftKey && (e.ctrlKey || e.metaKey),
          );
        } else {
          this.setSelectedAnnotation(id);
          this.beginMove(
            pageNumber,
            overlay,
            pageGeom,
            pageSize,
            g,
            id,
            start,
            e.pointerId,
            e.shiftKey && (e.ctrlKey || e.metaKey),
          );
        }
      });
      g.addEventListener('dblclick', (e) => {
        if (!this.isAnnotationSelectMode()) return;
        const annotation = overlay.annotations.get(id);
        if (!annotation || (annotation.subtype !== 'text' && annotation.subtype !== 'freeText')) return;
        e.preventDefault();
        e.stopPropagation();
        this.trackAnnotationTextEdit(this.editTextAnnotation(overlay, annotation));
      });
    }
  }

  /** Maps client (screen) coordinates to the overlay SVG's page-local px space. */
  private clientToPagePx(svg: SVGSVGElement, clientX: number, clientY: number): Offset {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  private beginDraw(
    pageNumber: number,
    overlay: AnnotationPageOverlay,
    pageGeom: PageGeometry,
    pageSize: Size,
    start: Offset,
    pointerId: number,
  ): void {
    const tool = this.drawingTool()!;
    const isShape = tool === 'rectangle' || tool === 'ellipse' || tool === 'highlight' || tool === 'freeText';
    const previewTag = tool === 'ellipse' ? 'ellipse' : isShape ? 'rect' : tool === 'ink' ? 'polyline' : 'line';
    const preview = document.createElementNS(SVG_NS, previewTag);
    const previewFill =
      tool === 'highlight'
        ? this.annotationStyle.color
        : (tool === 'rectangle' || tool === 'ellipse') && this.annotationStyle.fillColor
          ? this.annotationStyle.fillColor
          : 'none';
    preview.setAttribute('fill', previewFill);
    if (tool === 'highlight') {
      preview.setAttribute('fill-opacity', `${this.annotationStyle.opacity}`);
    }
    else if (previewFill !== 'none') preview.setAttribute('fill-opacity', `${this.annotationStyle.opacity}`);
    preview.setAttribute('stroke', this.annotationStyle.strokeWidth > 0 ? this.annotationStyle.color : 'none');
    preview.setAttribute('stroke-opacity', `${this.annotationStyle.opacity}`);
    preview.setAttribute('stroke-width', `${this.annotationStyle.strokeWidth}`);
    preview.setAttribute('stroke-linejoin', tool === 'ink' ? 'round' : 'miter');
    preview.setAttribute('stroke-linecap', tool === 'ink' ? 'round' : 'butt');
    (tool === 'highlight' ? overlay.highlightSvg : overlay.svg).appendChild(preview);
    try {
      overlay.svg.setPointerCapture(pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.drawState = { pageNumber, tool, pageGeom, pageSize, svg: overlay.svg, points: [start], preview, pointerId };
    if (tool === 'note') {
      // Click-to-place: no drag needed; commit immediately at pointerup.
    }
    this.updateDraw(start);
  }

  private updateDraw(current: Offset): void {
    const s = this.drawState;
    if (!s) return;
    if (s.tool === 'ink') {
      s.points.push(current);
      (s.preview as SVGPolylineElement).setAttribute('points', s.points.map(offsetPair).join(' '));
      return;
    }
    const start = s.points[0]!;
    if (s.tool === 'line' || s.tool === 'arrow') {
      const ln = s.preview as SVGLineElement;
      ln.setAttribute('x1', `${start.x}`);
      ln.setAttribute('y1', `${start.y}`);
      ln.setAttribute('x2', `${current.x}`);
      ln.setAttribute('y2', `${current.y}`);
      return;
    }
    // Rect-like preview (rectangle/ellipse/highlight/freeText).
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    if (s.tool === 'ellipse') {
      const inset = this.annotationStyle.strokeWidth / 2;
      const ell = s.preview as SVGEllipseElement;
      ell.setAttribute('cx', `${left + w / 2}`);
      ell.setAttribute('cy', `${top + h / 2}`);
      ell.setAttribute('rx', `${Math.max(0, w / 2 - inset)}`);
      ell.setAttribute('ry', `${Math.max(0, h / 2 - inset)}`);
    } else {
      const inset = s.tool === 'rectangle' ? this.annotationStyle.strokeWidth / 2 : 0;
      const r = s.preview as SVGRectElement;
      r.setAttribute('x', `${left + inset}`);
      r.setAttribute('y', `${top + inset}`);
      r.setAttribute('width', `${Math.max(0, w - inset * 2)}`);
      r.setAttribute('height', `${Math.max(0, h - inset * 2)}`);
    }
  }

  private async commitDraw(overlay: AnnotationPageOverlay, end: Offset): Promise<void> {
    const s = this.drawState;
    this.drawState = null;
    if (!s || !this.doc) return;
    try {
      s.svg.releasePointerCapture(s.pointerId);
    } catch {
      /* ignore */
    }
    s.preview.remove();
    const spec = this.buildSpecFromDraw(s, end);
    if (!spec) return;
    if (spec.subtype === 'text' || spec.subtype === 'freeText') {
      const contents = await this.requestAnnotationText(overlay, spec);
      if (contents === null) return;
      spec.contents = contents;
      if (spec.subtype === 'freeText') {
        await this.prepareFreeTextAppearance(spec);
      }
    }
    const id = await this.doc.addAnnotation(s.pageNumber, spec);
    this.recordAnnotationCommand({ pageNumber: s.pageNumber, id, before: null, after: spec });
    this.setAnnotationSelectMode(true);
    this.setSelectedAnnotation(id);
  }

  private ensureFreeTextFont(kind: FreeTextFontKind): Promise<string | null> {
    const existing = this.freeTextFonts.get(kind);
    if (existing) return existing;
    const pending = this.loadFreeTextFont(kind);
    this.freeTextFonts.set(kind, pending);
    return pending;
  }

  private async loadFreeTextFont(kind: FreeTextFontKind): Promise<string | null> {
    // Emoji runs are rasterized by the browser and never reach this path.
    if (kind === 'symbols') return null;
    const face = `PdfrxFreeText-${kind}`;
    const resolver = this.options.fontResolver === undefined ? googleFontsResolver : this.options.fontResolver;
    const resolution = resolver?.({ face, weight: 400, isItalic: false, charset: kind, pitchFamily: 0 });
    if (!resolution) return null;
    let download = this.fontDownloads.get(resolution.url);
    if (!download) {
      download = fetch(resolution.url)
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        })
        .catch((error: unknown) => {
          console.warn(`pdfrx: failed to download FreeText font ${resolution.url}:`, error);
          return null;
        });
      this.fontDownloads.set(resolution.url, download);
    }
    const data = await download;
    if (!data) return null;
    await this.#engine.addFontData(face, data, resolution.resolvedFace);
    return face;
  }

  private async prepareFreeTextAppearance(spec: PdfAnnotationSpec): Promise<void> {
    refreshFreeTextLayout(spec);
    const lines = spec.appearanceLines ?? [''];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) context.font = `${FREE_TEXT_FONT_SIZE}px Arial, sans-serif`;
    const graphemeSegmenter =
      typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    spec.appearanceRuns = [];
    for (const line of lines) {
      const graphemes = graphemeSegmenter ? [...graphemeSegmenter.segment(line)].map((part) => part.segment) : [...line];
      const kinds = graphemes.map(freeTextRunKind);
      // Common punctuation/whitespace belongs to the surrounding script. This
      // keeps Japanese 、。 in the CJK font instead of a glyph-less Latin font.
      for (let index = 0; index < kinds.length; index++) {
        if (kinds[index] !== 'neutral') continue;
        let previous: FreeTextRunKind | undefined;
        for (let cursor = index - 1; cursor >= 0; cursor--) {
          if (kinds[cursor] !== 'neutral') {
            previous = kinds[cursor];
            break;
          }
        }
        const next = kinds.slice(index + 1).find((kind) => kind !== 'neutral');
        kinds[index] = previous ?? next ?? 'latin';
      }
      const grouped: { text: string; kind: FreeTextRunKind }[] = [];
      for (let index = 0; index < graphemes.length; index++) {
        const grapheme = graphemes[index]!;
        const kind = kinds[index]!;
        const last = grouped[grouped.length - 1];
        if (last?.kind === kind) last.text += grapheme;
        else grouped.push({ text: grapheme, kind });
      }
      let x = 0;
      const runs: {
        text: string;
        fontFace: string | null;
        x: number;
        image?: { width: number; height: number; scale: number; pixels: Uint8Array };
      }[] = [];
      for (const group of grouped) {
        const fontFace =
          group.kind === 'latin' || group.kind === 'neutral' || group.kind === 'symbols'
            ? null
            : await this.ensureFreeTextFont(group.kind);
        const image = group.kind === 'symbols' ? renderFreeTextEmoji(group.text) : undefined;
        runs.push({ text: group.text, fontFace, x, ...(image ? { image } : {}) });
        x += context?.measureText(group.text).width ?? group.text.length * FREE_TEXT_FONT_SIZE * 0.6;
      }
      spec.appearanceRuns.push(runs);
    }
    spec.fontFace = spec.appearanceRuns.flat().find((run) => run.fontFace)?.fontFace ?? null;
  }

  private trackAnnotationTextEdit(operation: Promise<void>): void {
    const previous = this.pendingAnnotationTextEdit;
    this.pendingAnnotationTextEdit = Promise.all([previous, operation])
      .then(() => undefined)
      .catch((error: unknown) => {
        // A failed annotation write must not permanently poison subsequent
        // saves. The original operation is fire-and-forget from a pointer
        // handler, so report it here and leave the queue usable.
        console.error('Failed to commit annotation text:', error);
      });
  }

  /** Commits an open Text/FreeText editor and waits until its PDF write finishes. */
  async flushAnnotationTextEdit(): Promise<void> {
    const editor = this.annotationOverlayRoot.querySelector<HTMLTextAreaElement>(
      '.pdfrx-annotation-text-editor textarea',
    );
    editor?.blur();
    await this.pendingAnnotationTextEdit;
  }

  /** Opens a page-local editor for a new or existing Text/FreeText annotation. */
  private requestAnnotationText(
    overlay: AnnotationPageOverlay,
    spec: PdfAnnotationSpec,
  ): Promise<string | null> {
    const rect = spec.rect;
    if (!rect) return Promise.resolve(null);
    overlay.svg.querySelector('.pdfrx-annotation-text-editor')?.remove();
    const box = pdfRectToRect(rect, { page: overlay.pageGeom, scaledPageSize: overlay.pageSize });
    const isNote = spec.subtype === 'text';
    const width = isNote ? Math.min(180, Math.max(100, overlay.pageSize.width - box.right - 8)) : Math.max(40, rectWidth(box));
    const height = isNote ? 96 : Math.max(28, rectHeight(box));
    const x = isNote ? Math.min(box.right + 6, overlay.pageSize.width - width - 4) : box.left;
    const y = Math.min(box.top, overlay.pageSize.height - height - 4);
    const editorX = Math.max(4, x);
    const editorY = Math.max(4, y);
    const foreign = document.createElementNS(SVG_NS, 'foreignObject');
    foreign.setAttribute('class', 'pdfrx-annotation-text-editor');
    foreign.setAttribute('x', `${editorX}`);
    foreign.setAttribute('y', `${editorY}`);
    foreign.setAttribute('width', `${width}`);
    foreign.setAttribute('height', `${height}`);
    foreign.style.pointerEvents = 'auto';
    const textarea = document.createElement('textarea');
    textarea.value = spec.contents ?? '';
    textarea.placeholder = isNote ? 'Note' : 'Text';
    textarea.style.cssText =
      `box-sizing:border-box;width:100%;height:100%;resize:both;min-width:40px;min-height:28px;` +
      `max-width:${Math.max(40, overlay.pageSize.width - editorX)}px;` +
      `max-height:${Math.max(28, overlay.pageSize.height - editorY)}px;padding:5px;` +
      'font:12px Arial,Helvetica,sans-serif;color:#111;background:rgba(255,255,255,.96);' +
      'border:1px solid #2196f3;border-radius:2px;outline:none;box-shadow:0 2px 8px rgba(0,0,0,.22);';
    textarea.addEventListener('pointerdown', (event) => event.stopPropagation());
    foreign.appendChild(textarea);
    overlay.svg.appendChild(foreign);
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.min(overlay.pageSize.width - editorX, Math.max(40, textarea.offsetWidth));
      const nextHeight = Math.min(overlay.pageSize.height - editorY, Math.max(28, textarea.offsetHeight));
      foreign.setAttribute('width', `${nextWidth}`);
      foreign.setAttribute('height', `${nextHeight}`);
    });
    resizeObserver.observe(textarea);
    // Pointerup is followed by the browser's click/focus default action. Focus
    // on the next frame so that action cannot immediately blur and commit an
    // empty FreeText editor after a drag.
    requestAnimationFrame(() => {
      if (!textarea.isConnected) return;
      textarea.focus({ preventScroll: true });
      textarea.select();
    });
    return new Promise((resolve) => {
      let finished = false;
      let composing = false;
      let finishAfterComposition = false;
      const finish = (value: string | null): void => {
        if (finished) return;
        finished = true;
        resizeObserver.disconnect();
        foreign.remove();
        resolve(value);
      };
      textarea.addEventListener('compositionstart', () => {
        composing = true;
      });
      textarea.addEventListener('compositionend', () => {
        composing = false;
        if (finishAfterComposition) {
          finishAfterComposition = false;
          // The browser updates textarea.value as part of compositionend. Read
          // it in a microtask after that default processing has completed.
          queueMicrotask(() => finish(textarea.value));
        }
      });
      textarea.addEventListener('blur', () => {
        if (composing) {
          finishAfterComposition = true;
          return;
        }
        finish(textarea.value);
      });
      textarea.addEventListener('keydown', (event) => {
        if (event.isComposing || composing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          finish(textarea.value);
        }
      });
    });
  }

  /** Reopens the inline editor and records the contents change as one undo step. */
  private async editTextAnnotation(overlay: AnnotationPageOverlay, annotation: PdfAnnotationObject): Promise<void> {
    if (!this.doc) return;
    const before = annotationToSpec(annotation);
    const contents = await this.requestAnnotationText(overlay, before);
    if (contents === null || contents === (before.contents ?? '')) return;
    const after = structuredClone(before);
    after.contents = contents;
    if (after.subtype === 'freeText') {
      await this.prepareFreeTextAppearance(after);
    }
    await this.doc.updateAnnotation(overlay.pageNumber, annotation.id, after);
    this.recordAnnotationCommand({ pageNumber: overlay.pageNumber, id: annotation.id, before, after });
  }

  /** Converts a completed drawing gesture into an annotation spec (PDF coords). */
  private buildSpecFromDraw(s: DrawState, end: Offset): PdfAnnotationSpec | null {
    const toPdf = (o: Offset): PdfPoint => offsetToPdfPoint(o, { page: s.pageGeom, scaledPageSize: s.pageSize });
    const color = cssColorToRgba(this.annotationStyle.color, this.annotationStyle.opacity);
    const borderWidth = this.annotationStyle.strokeWidth;
    const start = s.points[0]!;
    const rectOf = (a: Offset, b: Offset) => {
      const p1 = toPdf(a);
      const p2 = toPdf(b);
      return {
        left: Math.min(p1.x, p2.x),
        top: Math.max(p1.y, p2.y),
        right: Math.max(p1.x, p2.x),
        bottom: Math.min(p1.y, p2.y),
      };
    };
    switch (s.tool) {
      case 'ink': {
        if (s.points.length < 2) return null;
        const stroke = s.points.map(toPdf);
        return { subtype: 'ink', rect: bboxOfPoints(stroke), color, borderWidth, geometry: { kind: 'ink', strokes: [stroke] } };
      }
      case 'line': {
        const minimum = LINE_MIN_SCREEN_LENGTH / this.transform.zoom;
        const [lineStart, lineEnd] = minimumDrawLine(start, end, minimum, s.pageSize);
        const stroke = [toPdf(lineStart), toPdf(lineEnd)];
        return { subtype: 'ink', rect: bboxOfPoints(stroke), color, borderWidth, geometry: { kind: 'ink', strokes: [stroke] } };
      }
      case 'arrow': {
        const minimum = LINE_MIN_SCREEN_LENGTH / this.transform.zoom;
        const [lineStart, lineEnd] = minimumDrawLine(start, end, minimum, s.pageSize);
        const strokes = arrowInkStrokes(toPdf(lineStart), toPdf(lineEnd));
        return { subtype: 'ink', rect: bboxOfPoints(strokes.flat()), color, borderWidth, geometry: { kind: 'ink', strokes } };
      }
      case 'rectangle':
      case 'ellipse': {
        const minimum = SHAPE_MIN_SCREEN_SIZE / this.transform.zoom;
        const box = minimumDrawRect(
          start,
          end,
          Math.min(s.pageSize.width, minimum),
          Math.min(s.pageSize.height, minimum),
          s.pageSize,
        );
        const interiorColor = this.annotationStyle.fillColor
          ? cssColorToRgba(this.annotationStyle.fillColor, this.annotationStyle.opacity)
          : undefined;
        return {
          subtype: s.tool === 'rectangle' ? 'square' : 'circle',
          rect: rectOf({ x: box.left, y: box.top }, { x: box.right, y: box.bottom }),
          color,
          interiorColor,
          borderWidth,
        };
      }
      case 'highlight': {
        const r = rectOf(start, end);
        if (r.right - r.left < 1 || r.top - r.bottom < 1) return null;
        return {
          subtype: 'highlight',
          rect: r,
          color,
          geometry: {
            kind: 'markup',
            quads: [
              {
                topLeft: { x: r.left, y: r.top },
                topRight: { x: r.right, y: r.top },
                bottomLeft: { x: r.left, y: r.bottom },
                bottomRight: { x: r.right, y: r.bottom },
              },
            ],
          },
        };
      }
      case 'note': {
        const p = toPdf(start);
        return {
          subtype: 'text',
          rect: { left: p.x, top: p.y, right: p.x + 18, bottom: p.y - 18 },
          color,
          contents: '',
        };
      }
      case 'freeText': {
        // A click (or an imprecise short touch drag) would otherwise create a
        // zero/tiny PDF rect even though the inline editor itself has a usable
        // size. Expand in the gesture direction, then shift the box back inside
        // the page while preserving a zoom-independent minimum on screen.
        const minWidth = Math.min(s.pageSize.width, FREE_TEXT_MIN_SCREEN_WIDTH / this.transform.zoom);
        const minHeight = Math.min(s.pageSize.height, FREE_TEXT_MIN_SCREEN_HEIGHT / this.transform.zoom);
        const box = minimumDrawRect(start, end, minWidth, minHeight, s.pageSize);
        const r = rectOf({ x: box.left, y: box.top }, { x: box.right, y: box.bottom });
        const interiorColor = this.annotationStyle.fillColor
          ? cssColorToRgba(this.annotationStyle.fillColor, this.annotationStyle.opacity)
          : undefined;
        return { subtype: 'freeText', rect: r, color, interiorColor, borderWidth, contents: '' };
      }
    }
  }

  private beginMove(
    pageNumber: number,
    overlay: AnnotationPageOverlay,
    pageGeom: PageGeometry,
    pageSize: Size,
    g: SVGGElement,
    id: string,
    start: Offset,
    pointerId: number,
    duplicate: boolean,
  ): void {
    const annotation = overlay.annotations.get(id);
    if (!annotation) return;
    const display = this.annotationDisplayGroup(overlay, id, g);
    try {
      g.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    const preview = duplicate ? (display.cloneNode(true) as SVGGElement) : display;
    if (duplicate) {
      preview.removeAttribute('data-annot-id');
      preview.removeAttribute('data-annot-visual-id');
      preview.style.pointerEvents = 'none';
      display.parentNode?.insertBefore(preview, display.nextSibling);
    }
    const displacement = (e: PointerEvent): Offset => {
      const cur = this.clientToPagePx(overlay.svg, e.clientX, e.clientY);
      let dx = cur.x - start.x;
      let dy = cur.y - start.y;
      if (duplicate) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      return { x: dx, y: dy };
    };
    const move = (e: PointerEvent): void => {
      const delta = displacement(e);
      const transform = `translate(${delta.x} ${delta.y})`;
      preview.setAttribute('transform', transform);
      // Move the anchors + bounding box rigidly with the shape.
      if (!duplicate) overlay.anchorLayer.setAttribute('transform', transform);
    };
    const up = (e: PointerEvent): void => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      const delta = displacement(e);
      const dxPx = delta.x;
      const dyPx = delta.y;
      if (Math.abs(dxPx) < 0.5 && Math.abs(dyPx) < 0.5) {
        // A click, not a move: undo the (tiny) live transform.
        preview.removeAttribute('transform');
        if (duplicate) preview.remove();
        overlay.anchorLayer.removeAttribute('transform');
        return;
      }
      // A real move: keep the live transform so the shape/anchors hold their new
      // spot until the reload replaces this overlay (avoids a snap-back flicker).
      const scale = pageSize.height / pageGeom.height;
      const dx = dxPx / scale;
      const dy = -dyPx / scale;
      if (duplicate) {
        // Keep the clone visible until the annotation-change reload atomically
        // replaces this overlay; removing it now would flash an empty gap.
        void this.commitDuplicate(pageNumber, [annotation], dx, dy).catch(() => preview.remove());
      } else {
        void this.commitMove(pageNumber, annotation, dx, dy);
      }
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  }

  private async commitMove(pageNumber: number, a: PdfAnnotationObject, dx: number, dy: number): Promise<void> {
    if (!this.doc) return;
    const before = annotationToSpec(a);
    const after = translateAnnotationSpec(a, dx, dy);
    await this.doc.updateAnnotation(pageNumber, a.id, after);
    this.recordAnnotationCommand({ pageNumber, id: a.id, before, after });
  }

  /** Commits a constrained modifier-drag as newly created annotations. */
  private async commitDuplicate(
    pageNumber: number,
    annotations: readonly PdfAnnotationObject[],
    dx: number,
    dy: number,
  ): Promise<void> {
    if (!this.doc || annotations.length === 0) return;
    const entries = annotations.map((annotation) => ({
      pageNumber,
      spec: translateAnnotationSpec(annotation, dx, dy),
    }));
    const create = (): Promise<void> => this.createDuplicateEntries(entries, dx, dy);
    const pending = this.annotationDuplicateQueue.then(create, create);
    this.annotationDuplicateQueue = pending.catch(() => undefined);
    await pending;
  }

  /** Whether Ctrl/Cmd+D can repeat the immediately preceding drag duplication. */
  canRepeatAnnotationDuplicate(): boolean {
    const repeat = this.annotationDuplicateRepeat;
    return (
      repeat !== null &&
      repeat.selectedIds.length === this.selectedAnnotationIds.size &&
      repeat.selectedIds.every((id) => this.selectedAnnotationIds.has(id))
    );
  }

  /** Repeats the last modifier-drag duplication using the same displacement. */
  async repeatAnnotationDuplicate(): Promise<boolean> {
    if (!this.annotationDuplicateRepeat) return false;
    let duplicated = false;
    const create = async (): Promise<void> => {
      const repeat = this.annotationDuplicateRepeat;
      if (!repeat || !this.canRepeatAnnotationDuplicate()) return;
      const entries = repeat.entries.map((entry) => ({
        pageNumber: entry.pageNumber,
        spec: translateSpec(entry.spec, repeat.dx, repeat.dy),
      }));
      await this.createDuplicateEntries(entries, repeat.dx, repeat.dy);
      duplicated = true;
    };
    const pending = this.annotationDuplicateQueue.then(create, create);
    this.annotationDuplicateQueue = pending.catch(() => undefined);
    await pending;
    return duplicated;
  }

  /** Creates a duplicate group, selects it, and arms the next Ctrl/Cmd+D repeat. */
  private async createDuplicateEntries(
    entries: readonly AnnotationClipboardEntry[],
    dx: number,
    dy: number,
  ): Promise<void> {
    if (!this.doc) return;
    const group: AnnotationCommand[] = [];
    const ids: string[] = [];
    const created: AnnotationClipboardEntry[] = [];
    for (const entry of entries) {
      if (entry.pageNumber < 1 || entry.pageNumber > this.doc.pages.length) continue;
      const spec = structuredClone(entry.spec);
      const id = await this.doc.addAnnotation(entry.pageNumber, spec);
      group.push({ pageNumber: entry.pageNumber, id, before: null, after: spec });
      ids.push(id);
      created.push({ pageNumber: entry.pageNumber, spec });
    }
    if (group.length === 0) return;
    this.recordAnnotationCommandGroup(group);
    this.setAnnotationSelectMode(true);
    this.setSelectedAnnotations(ids);
    this.annotationDuplicateRepeat = { entries: created, selectedIds: ids, dx, dy };
  }

  // -------------------------------------------------------------------------
  // Marquee (rubber-band) selection and group move/resize.
  // -------------------------------------------------------------------------

  /** Rubber-band selection: drag a rectangle; select every overlapping annotation. */
  private beginMarquee(overlay: AnnotationPageOverlay, start: Offset, pointerId: number): void {
    this.setSelectedAnnotations([]);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('fill', 'rgba(33, 150, 243, 0.12)');
    rect.setAttribute('stroke', '#2196f3');
    rect.setAttribute('stroke-width', `${1 / this.transform.zoom}`);
    rect.setAttribute('stroke-dasharray', `${4 / this.transform.zoom} ${3 / this.transform.zoom}`);
    rect.style.pointerEvents = 'none';
    overlay.anchorLayer.appendChild(rect);
    try {
      overlay.svg.setPointerCapture(pointerId);
    } catch {
      /* best-effort */
    }
    const place = (cur: Offset): { left: number; top: number; right: number; bottom: number } => {
      const left = Math.min(start.x, cur.x);
      const top = Math.min(start.y, cur.y);
      rect.setAttribute('x', `${left}`);
      rect.setAttribute('y', `${top}`);
      rect.setAttribute('width', `${Math.abs(cur.x - start.x)}`);
      rect.setAttribute('height', `${Math.abs(cur.y - start.y)}`);
      return { left, top, right: Math.max(start.x, cur.x), bottom: Math.max(start.y, cur.y) };
    };
    place(start);
    const move = (e: PointerEvent): void => {
      place(this.clientToPagePx(overlay.svg, e.clientX, e.clientY));
    };
    const up = (e: PointerEvent): void => {
      overlay.svg.removeEventListener('pointermove', move);
      overlay.svg.removeEventListener('pointerup', up);
      overlay.svg.removeEventListener('pointercancel', up);
      const boxPx = place(this.clientToPagePx(overlay.svg, e.clientX, e.clientY));
      rect.remove();
      // Select every annotation whose on-page px bounds overlap the marquee.
      const hit: string[] = [];
      for (const [id, a] of overlay.annotations) {
        const shapeBox = this.annotationPxBounds(a, overlay);
        if (shapeBox && rectsOverlap(boxPx, shapeBox)) hit.push(id);
      }
      this.setSelectedAnnotations(hit);
    };
    overlay.svg.addEventListener('pointermove', move);
    overlay.svg.addEventListener('pointerup', up);
    overlay.svg.addEventListener('pointercancel', up);
  }

  /** On-page px bounding box of an annotation, or null. */
  private annotationPxBounds(a: PdfAnnotationObject, overlay: AnnotationPageOverlay): { left: number; top: number; right: number; bottom: number } | null {
    const b = annotationBounds(a);
    const opts = { page: overlay.pageGeom, scaledPageSize: overlay.pageSize };
    const p1 = pdfPointToOffset({ x: b.left, y: b.top }, opts);
    const p2 = pdfPointToOffset({ x: b.right, y: b.bottom }, opts);
    return { left: Math.min(p1.x, p2.x), top: Math.min(p1.y, p2.y), right: Math.max(p1.x, p2.x), bottom: Math.max(p1.y, p2.y) };
  }

  /** Drags the whole multi-selection rigidly, committing one grouped move. */
  private beginGroupMove(
    overlay: AnnotationPageOverlay,
    sel: PdfAnnotationObject[],
    start: Offset,
    pointerId: number,
    duplicate: boolean,
  ): void {
    const svg = overlay.svg;
    const groups = new Map<string, SVGGElement>();
    for (const child of Array.from(svg.children)) {
      const g = child as SVGGElement;
      if (g.dataset.annotId && this.selectedAnnotationIds.has(g.dataset.annotId)) groups.set(g.dataset.annotId, g);
    }
    const displayGroups = new Map(
      [...groups].map(([id, g]) => [id, this.annotationDisplayGroup(overlay, id, g)] as const),
    );
    const previews = duplicate
      ? [...displayGroups.values()].map((g) => {
          const clone = g.cloneNode(true) as SVGGElement;
          clone.removeAttribute('data-annot-id');
          clone.removeAttribute('data-annot-visual-id');
          clone.style.pointerEvents = 'none';
          g.parentNode?.insertBefore(clone, g.nextSibling);
          return clone;
        })
      : [...displayGroups.values()];
    try {
      svg.setPointerCapture(pointerId);
    } catch {
      /* best-effort */
    }
    const displacement = (e: PointerEvent): Offset => {
      const cur = this.clientToPagePx(svg, e.clientX, e.clientY);
      let dx = cur.x - start.x;
      let dy = cur.y - start.y;
      if (duplicate) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      return { x: dx, y: dy };
    };
    const move = (e: PointerEvent): void => {
      const delta = displacement(e);
      const transform = `translate(${delta.x} ${delta.y})`;
      for (const g of previews) g.setAttribute('transform', transform);
      if (!duplicate) overlay.anchorLayer.setAttribute('transform', transform);
    };
    const up = (e: PointerEvent): void => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
      const delta = displacement(e);
      const dxPx = delta.x;
      const dyPx = delta.y;
      if (Math.abs(dxPx) < 0.5 && Math.abs(dyPx) < 0.5) {
        for (const g of previews) {
          if (duplicate) g.remove();
          else g.removeAttribute('transform');
        }
        overlay.anchorLayer.removeAttribute('transform');
        return;
      }
      const scale = overlay.pageSize.height / overlay.pageGeom.height;
      const dx = dxPx / scale;
      const dy = -dyPx / scale;
      if (duplicate) {
        // Successful document writes replace the whole overlay and naturally
        // discard these clones. Only clean them up directly if the write fails.
        void this.commitDuplicate(overlay.pageNumber, sel, dx, dy).catch(() => {
          for (const g of previews) g.remove();
        });
      } else {
        void this.commitGroupTransform(overlay, sel, (a) => translateAnnotationSpec(a, dx, dy));
      }
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }

  /** Drags one group-box handle, scaling every selected annotation together. */
  private beginGroupResize(
    overlay: AnnotationPageOverlay,
    sel: PdfAnnotationObject[],
    box: PdfRect,
    index: number,
    circle: SVGCircleElement,
    pointerId: number,
  ): void {
    try {
      circle.setPointerCapture(pointerId);
    } catch {
      /* best-effort */
    }
    circle.style.cursor = 'grabbing';
    let newBox: PdfRect | null = null;
    const move = (e: PointerEvent): void => {
      const px = this.clientToPagePx(overlay.svg, e.clientX, e.clientY);
      const to = offsetToPdfPoint(px, { page: overlay.pageGeom, scaledPageSize: overlay.pageSize });
      newBox = resizeBoxByHandle(box, index, to);
      // Live-preview every member scaled into the new group box.
      for (const a of sel) this.previewAnnotationShape(overlay, a, scaleAnnotationSpec(a, box, newBox));
      this.updateGroupAnchorPositions(overlay, newBox);
    };
    const up = (): void => {
      circle.removeEventListener('pointermove', move);
      circle.removeEventListener('pointerup', up);
      circle.removeEventListener('pointercancel', up);
      circle.style.cursor = 'grab';
      if (!newBox) return;
      const target = newBox;
      void this.commitGroupTransform(overlay, sel, (a) => scaleAnnotationSpec(a, box, target));
    };
    circle.addEventListener('pointermove', move);
    circle.addEventListener('pointerup', up);
    circle.addEventListener('pointercancel', up);
  }

  /** Moves the group box + its handles to a new box in place (during a resize). */
  private updateGroupAnchorPositions(overlay: AnnotationPageOverlay, box: PdfRect): void {
    const opts = { page: overlay.pageGeom, scaledPageSize: overlay.pageSize };
    const rectEl = overlay.anchorLayer.querySelector('rect');
    if (rectEl) {
      const tl = pdfPointToOffset({ x: box.left, y: box.top }, opts);
      const br = pdfPointToOffset({ x: box.right, y: box.bottom }, opts);
      rectEl.setAttribute('x', `${Math.min(tl.x, br.x)}`);
      rectEl.setAttribute('y', `${Math.min(tl.y, br.y)}`);
      rectEl.setAttribute('width', `${Math.abs(br.x - tl.x)}`);
      rectEl.setAttribute('height', `${Math.abs(br.y - tl.y)}`);
    }
    const circles = overlay.anchorLayer.querySelectorAll('circle');
    boundingBoxHandlePoints(box).forEach((pt, i) => {
      const c = circles[i];
      if (!c) return;
      const px = pdfPointToOffset(pt, opts);
      c.setAttribute('cx', `${px.x}`);
      c.setAttribute('cy', `${px.y}`);
    });
  }

  /** Applies `makeSpec` to every member of the selection as one undoable group. */
  private async commitGroupTransform(
    overlay: AnnotationPageOverlay,
    sel: PdfAnnotationObject[],
    makeSpec: (a: PdfAnnotationObject) => PdfAnnotationSpec,
  ): Promise<void> {
    if (!this.doc) return;
    const group: AnnotationCommand[] = [];
    for (const a of sel) {
      const before = annotationToSpec(a);
      const after = makeSpec(a);
      refreshFreeTextLayout(after);
      if (after.subtype === 'freeText') await this.prepareFreeTextAppearance(after);
      await this.doc.updateAnnotation(overlay.pageNumber, a.id, after);
      group.push({ pageNumber: overlay.pageNumber, id: a.id, before, after });
    }
    this.recordAnnotationCommandGroup(group);
  }

  /**
   * Draws the drop shadow behind every visible page in screen space, so the
   * shadow keeps a constant on-screen size at any zoom. The filled rectangles
   * are later covered exactly by the opaque page background, leaving only the
   * shadow (outside each page) visible.
   */
  private paintPageShadows(dpr: number, t: ViewTransform, visible: Rect): void {
    const s = this.resolvedPageDropShadow;
    if (!s || !this.layout) return;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.blur;
    ctx.shadowOffsetX = s.offsetX;
    ctx.shadowOffsetY = s.offsetY;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectOverlaps(pageRect, visible)) continue;
      const vr = documentRectToView(t, pageRect);
      ctx.fillRect(vr.left, vr.top, vr.right - vr.left, vr.bottom - vr.top);
    }
    ctx.restore();
  }

  /** Strokes a border around every visible page in screen space (crisp at any zoom). */
  private paintPageBorders(dpr: number, t: ViewTransform, visible: Rect): void {
    const b = this.resolvedPageBorder;
    if (!b || !this.layout) return;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width;
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectOverlaps(pageRect, visible)) continue;
      const vr = documentRectToView(t, pageRect);
      ctx.strokeRect(vr.left, vr.top, vr.right - vr.left, vr.bottom - vr.top);
    }
  }

  /** Runs custom page painters in document space, isolating context state and errors. */
  private runPagePainters(callbacks: PagePaintCallback[], pageRect: Rect, page: PdfPage): void {
    const ctx = this.ctx;
    for (const cb of callbacks) {
      ctx.save();
      try {
        cb(ctx, pageRect, page);
      } catch (e) {
        console.error('Error in page paint callback:', e);
      } finally {
        ctx.restore();
      }
    }
  }

  /**
   * Draws pages and the selection highlight in document coordinates.
   * The ctx transform (document -> device) must already be set; this is
   * shared by the main view pass and the magnifier lens.
   */
  private paintDocContent(visible: Rect): void {
    const ctx = this.ctx;
    if (!this.layout || !this.cache) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const bgCallbacks = this.options.pageBackgroundPaintCallbacks;
    const fgCallbacks = this.options.pagePaintCallbacks;
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectOverlaps(pageRect, visible)) continue;
      const pageNumber = i + 1;
      const page = this.doc?.pages[i];

      if (page && bgCallbacks?.length) this.runPagePainters(bgCallbacks, pageRect, page);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(pageRect.left, pageRect.top, rectWidth(pageRect), rectHeight(pageRect));

      const base = this.cache.getBase(pageNumber);
      if (base) {
        ctx.drawImage(base.bitmap, pageRect.left, pageRect.top, rectWidth(pageRect), rectHeight(pageRect));
      }
      const patch = this.cache.getPatch(pageNumber);
      if (patch) {
        ctx.drawImage(patch.bitmap, patch.rect.left, patch.rect.top, rectWidth(patch.rect), rectHeight(patch.rect));
      }

      if (page && fgCallbacks?.length) this.runPagePainters(fgCallbacks, pageRect, page);
    }

    // Search match highlights (below the selection highlight)
    if (this.searcher?.hasMatches) {
      const currentMatch = this.searcher.currentMatch;
      for (let i = 0; i < this.layout.pageLayouts.length; i++) {
        const pageRect = this.layout.pageLayouts[i]!;
        if (!rectOverlaps(pageRect, visible)) continue;
        const range = this.searcher.getMatchesRangeForPage(i + 1);
        if (!range) continue;
        const pageGeom = this.pageGeoms[i]!;
        for (let m = range.start; m < range.end; m++) {
          const match = this.searcher.matches[m]!;
          const r = pdfRectToRectInDocument(match.bounds, pageGeom, pageRect);
          ctx.fillStyle =
            match === currentMatch
              ? (this.options.activeMatchTextColor ?? 'rgba(255, 152, 0, 0.5)')
              : (this.options.matchTextColor ?? 'rgba(255, 235, 59, 0.5)');
          ctx.fillRect(r.left, r.top, rectWidth(r), rectHeight(r));
        }
      }
    }

    if (this.selA && this.selB) {
      ctx.fillStyle = this.options.selectionColor ?? 'rgba(33, 150, 243, 0.35)';
      const ranges = getSelectedRanges(this.selA, this.selB, (n) => this.getLoadedText(n));
      for (const range of ranges) {
        const pageIndex = range.pageText.pageNumber - 1;
        const pageGeom = this.pageGeoms[pageIndex]!;
        const pageRect = this.layout.pageLayouts[pageIndex]!;
        for (const fr of enumerateFragmentBoundingRects({
          pageText: range.pageText,
          start: range.start,
          end: range.end,
        })) {
          const r: Rect = pdfRectToRectInDocument(fr.bounds, pageGeom, pageRect);
          ctx.fillRect(r.left, r.top, rectWidth(r), rectHeight(r));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Magnifier
  // (_shouldShowMagnifierForAnchor, _getMagnifierRect, calcPosition)
  // -------------------------------------------------------------------------

  /** Show the magnifier only when the character is smaller than this on screen (px). */
  private static readonly MAGNIFIER_SIZE_THRESHOLD = 72;
  private static readonly LENS_WIDTH = 144;
  private static readonly LENS_HEIGHT = 56;
  private static readonly LENS_RADIUS = 12;

  private paintMagnifier(dpr: number): void {
    if (this.mode.kind !== 'dragHandle' || this.mode.pointerType !== 'touch') return;
    if (!this.anchors || !this.selA || !this.selB) return;
    const t = this.transform;

    // Map the dragged part to the visual anchor: dragging A moves the visual
    // start only if selA <= selB.
    const aIsStart = selectionPointLE(this.selA, this.selB);
    const visualPart = this.mode.part === 'a' ? (aIsStart ? 'a' : 'b') : aIsStart ? 'b' : 'a';
    const anchor = this.anchors[visualPart];

    // _shouldShowMagnifierForAnchor: only for characters small on screen
    const charExtent = anchor.direction === 'vrtl' ? rectWidth(anchor.rect) : rectHeight(anchor.rect);
    if (charExtent * t.zoom >= PdfrxViewer.MAGNIFIER_SIZE_THRESHOLD) return;

    // _getMagnifierRect: the anchor char rect inflated along the text direction
    const r = anchor.rect;
    const content: Rect =
      anchor.direction === 'vrtl'
        ? {
            left: r.left - rectWidth(r) * 0.2,
            top: r.top - rectWidth(r) * 2,
            right: r.right + rectWidth(r) * 0.2,
            bottom: r.bottom + rectWidth(r) * 2,
          }
        : {
            left: r.left - rectHeight(r) * 2,
            top: r.top - rectHeight(r) * 0.2,
            right: r.right + rectHeight(r) * 2,
            bottom: r.bottom + rectHeight(r) * 0.2,
          };
    if (rectIsEmpty(content)) return;

    const pos = this.calcMagnifierPosition(anchor.direction, visualPart, documentRectToView(t, anchor.rect));

    const W = PdfrxViewer.LENS_WIDTH;
    const H = PdfrxViewer.LENS_HEIGHT;
    const ctx = this.ctx;
    const path = new Path2D();
    path.roundRect(pos.x, pos.y, W, H, PdfrxViewer.LENS_RADIUS);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // drop shadow + opaque background
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fill(path);
    ctx.restore();

    // magnified content (scale from the content rect's top-left)
    ctx.save();
    ctx.clip(path);
    const magScale = Math.max(W / rectWidth(content), H / rectHeight(content));
    ctx.transform(magScale, 0, 0, magScale, pos.x - content.left * magScale, pos.y - content.top * magScale);
    this.paintDocContent(content);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke(path);
  }

  /** Positions the magnifier lens (margins 10 / top 20 / bottom 80), clamped to the viewport. */
  private calcMagnifierPosition(
    direction: import('@pdfrx/viewer-core').PdfTextDirection,
    part: 'a' | 'b',
    anchorLocalRect: Rect,
  ): Offset {
    const W = PdfrxViewer.LENS_WIDTH;
    const H = PdfrxViewer.LENS_HEIGHT;
    const margin = 10;
    const marginOnTop = 20;
    const marginOnBottom = 80;
    const view = this.viewSize;
    const cx = (anchorLocalRect.left + anchorLocalRect.right) / 2;
    const cy = (anchorLocalRect.top + anchorLocalRect.bottom) / 2;

    let left: number;
    let top: number;
    if (direction === 'vrtl') {
      if (part === 'a') {
        left = anchorLocalRect.right + margin;
        if (left + W + margin > view.width) left = anchorLocalRect.left - W - margin;
      } else {
        left = anchorLocalRect.left - W - margin;
        if (left < margin) left = anchorLocalRect.right + margin;
      }
      top = cy - H / 2;
      if (top < margin) top = margin;
      else if (top + H + margin > view.height) top = view.height - H - margin;
    } else {
      left = cx - W / 2 + margin;
      if (left < margin) left = margin;
      else if (left + W + margin > view.width) left = view.width - W - margin;
      top = anchorLocalRect.top - H - marginOnTop;
      if (top < margin) top = anchorLocalRect.bottom + marginOnBottom;
    }

    // normalizeWidgetPosition (margin 8)
    const nm = 8;
    if (left + W + nm > view.width) left = view.width - W - nm;
    if (left < nm) left = nm;
    if (top + H + nm > view.height) top = view.height - H - nm;
    if (top < nm) top = nm;
    return { x: left, y: top };
  }
}

/**
 * Writes `text` to the system clipboard, in both secure and non-secure contexts.
 *
 * The async Clipboard API (`navigator.clipboard`) only exists in a *secure*
 * context — HTTPS or `localhost`. A page served over plain HTTP, which is what
 * a phone gets when it opens a dev server by its LAN IP (`http://192.168.x.x`),
 * has no `navigator.clipboard` at all, so the direct `writeText` call throws and
 * copy silently fails on mobile while working on a desktop `localhost`. When the
 * API is unavailable we fall back to a hidden `<textarea>` and
 * `document.execCommand('copy')`, which still works inside a user gesture.
 *
 * Call this synchronously from a user gesture (a click/tap handler).
 */
async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  legacyCopyText(text);
}

/**
 * Clipboard fallback for non-secure contexts (and browsers without the async
 * Clipboard API): select the text in a detached, off-screen `<textarea>` and
 * `execCommand('copy')`. Handles iOS Safari, which ignores `textarea.select()`
 * and needs an explicit range.
 */
function legacyCopyText(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // `readonly` keeps the on-screen keyboard from popping up on mobile.
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0;';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    // iOS Safari ignores textarea.select(); selecting the node's contents via a
    // Range and then setting an explicit selection range is what works there.
    const range = document.createRange();
    range.selectNodeContents(textarea);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textarea.setSelectionRange(0, text.length);
    document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
