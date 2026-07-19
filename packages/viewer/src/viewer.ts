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
  type PdfDest,
  type PdfDocument,
  type PdfFontQuery,
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
  layoutPagesVertical,
  pdfRectToRectInDocument,
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
  /** Background color of the viewer. Default: '#808080'. */
  backgroundColor?: string;
  /** Selection highlight fill style. Default: 'rgba(33, 150, 243, 0.35)'. */
  selectionColor?: string;
  /** Selection handle color (touch). Default: '#2196f3'. */
  handleColor?: string;
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
   */
  fontResolver?: FontResolver | null;
}

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

type InteractionMode =
  | { kind: 'none' }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number; moved: boolean; startedAt: number }
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

const HANDLE_HIT_RADIUS = 24;
const TAP_SLOP = 4;
const LONG_PRESS_MS = 500;

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
    this.engine = options.engine ?? new PdfrxEngine(options.engineOptions ?? { wasmModulesUrl: 'pdfium/' });
    this.ownsEngine = !options.engine;

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

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private readonly container: HTMLElement;
  private readonly options: PdfrxViewerOptions;
  private readonly engine: PdfrxEngine;
  private readonly ownsEngine: boolean;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlayRoot: HTMLDivElement;
  /** Per-page overlay containers, built lazily when a page first becomes visible. */
  private readonly overlayContainers = new Map<number, HTMLElement>();
  private readonly resizeObserver: ResizeObserver;

  private doc: PdfDocument | null = null;
  private pageGeoms: PageGeometry[] = [];
  private layout: PageLayout | null = null;
  private cache: PageRenderCache | null = null;
  private readonly pageTexts = new Map<number, PdfPageText | Promise<PdfPageText>>();
  private readonly pageLinks = new Map<number, PdfLink[] | Promise<PdfLink[]>>();
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
  private menuEl: HTMLDivElement | null = null;
  private pendingMenuOnUp = false;
  private searcher: PdfTextSearcher | null = null;
  private currentSource:
    | { kind: 'url'; url: string | URL; options: PdfOpenUrlOptions }
    | { kind: 'data'; data: Uint8Array | ArrayBuffer; options: PdfOpenOptions }
    | null = null;
  private readonly documentChangeListeners = new Set<() => void>();

  private selA: SelectionPoint | null = null;
  private selB: SelectionPoint | null = null;
  private anchors: SelectionAnchors | null = null;
  /** Show draggable handles (touch-driven selections). */
  private showHandles = false;

  private rafId: number | null = null;
  private paintTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

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
    const doc = await this.engine.openUrl(url, options);
    this.currentSource = { kind: 'url', url, options };
    await this.setDocument(doc);
  }

  /**
   * Opens a document from in-memory bytes and displays it, replacing any current
   * document. The source is retained for the missing-font reopen (see
   * {@link openUrl}).
   */
  async openData(data: Uint8Array | ArrayBuffer, options: PdfOpenOptions = {}): Promise<void> {
    const doc = await this.engine.openData(data, options);
    this.currentSource = { kind: 'data', data, options };
    await this.setDocument(doc);
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

  /** The currently open {@link PdfDocument}, or `null` before the first open. */
  get document(): PdfDocument | null {
    return this.doc;
  }

  /**
   * The current view transform (uniform zoom + pan). Document→view mapping used
   * throughout the viewer.
   */
  get currentTransform(): ViewTransform {
    return this.transform;
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
   * Copies the current selection to the system clipboard.
   *
   * @returns `true` if there was text to copy (and the write was attempted),
   *   `false` if the selection was empty.
   */
  async copySelection(): Promise<boolean> {
    const text = this.selectedText;
    if (!text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  }

  /** Fit the given page (1-based) into the view — alias of {@link fitToPage}. */
  goToPage(pageNumber: number): void {
    this.fitToPage(pageNumber);
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
   */
  fitToPage(pageNumber?: number): void {
    const t = this.fitTransform(pageNumber ?? this.currentPageNumber ?? 1, 'page');
    if (t) this.setTransform(t);
  }

  /**
   * Scale a page so its width fills the viewport, aligning the top of the page
   * to the top of the viewport. Defaults to the current page. This is the
   * "Fit Width" action (a common default for continuous reading).
   */
  fitToWidth(pageNumber?: number): void {
    const t = this.fitTransform(pageNumber ?? this.currentPageNumber ?? 1, 'width');
    if (t) this.setTransform(t);
  }

  /**
   * Scale a page so its height fills the viewport, centered horizontally.
   * Defaults to the current page. This is the "Fit Height" action.
   */
  fitToHeight(pageNumber?: number): void {
    const t = this.fitTransform(pageNumber ?? this.currentPageNumber ?? 1, 'height');
    if (t) this.setTransform(t);
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
   */
  goToDest(dest: PdfDest | null): void {
    if (!dest) return;
    const t = this.calcTransformForDest(dest);
    if (t) this.setTransform(t);
    else this.goToPage(dest.pageNumber);
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
   */
  setZoom(zoom: number, viewCenter?: Offset): void {
    const center = viewCenter ?? { x: this.viewSize.width / 2, y: this.viewSize.height / 2 };
    this.zoomAt(center, zoom);
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
    this.stopAutoScroll();
    this.stopFling();
    this.resizeObserver.disconnect();
    this.hideContextMenu();
    this.searcher?.dispose();
    this.cache?.dispose();
    void this.doc?.dispose();
    if (this.ownsEngine) this.engine.dispose();
    this.overlayRoot.remove();
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
    this.pageTexts.clear();
    this.overlayContainers.clear();
    this.overlayRoot.replaceChildren();
    this.clearSelection();

    this.doc = doc;
    this.pageGeoms = doc.pages.map((p) => ({ width: p.width, height: p.height, rotation: p.rotation / 90 }));
    this.layout = layoutPagesVertical(this.pageGeoms, { margin: this.margin });
    this.cache = new PageRenderCache(doc, () => this.invalidate());
    this.pageLinks.clear();
    this.hoveredLink = null;
    doc.addEventListener('missingFonts', ({ queries }) => this.onMissingFonts(queries));
    this.resetView();
    for (const listener of this.documentChangeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in document change listener:', e);
      }
    }
  }

  private resetView(): void {
    if (!this.layout || this.viewSize.width <= 0 || this.viewSize.height <= 0) return;
    const t = this.fitTransform(1, this.options.initialFit ?? 'page');
    if (t) this.setTransform(t);
  }

  private onResize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.viewSize = { width: rect.width, height: rect.height };
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (this.layout && this.transform.zoom === 1 && this.transform.xZoomed === 0 && this.transform.yZoomed === 0) {
      this.resetView();
    } else {
      this.setTransform(this.transform); // re-clamp
    }
  }

  // -------------------------------------------------------------------------
  // Transform
  // -------------------------------------------------------------------------

  private clamp(t: ViewTransform): ViewTransform {
    if (!this.layout) return t;
    const margins = adjustBoundaryMargins(this.viewSize, t.zoom, this.layout.documentSize, edgeInsetsZero);
    return clampToBoundary(t, this.viewSize, this.layout.documentSize, margins);
  }

  private setTransform(t: ViewTransform): void {
    this.transform = this.clamp(t);
    this.invalidate();
  }

  private zoomAt(viewPoint: Offset, newZoom: number): void {
    const zoom = Math.min(Math.max(newZoom, this.minZoom), this.maxZoom);
    const docPoint = viewToDocument(this.transform, viewPoint);
    this.setTransform({
      zoom,
      xZoomed: viewPoint.x - docPoint.x * zoom,
      yZoomed: viewPoint.y - docPoint.y * zoom,
    });
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
    const promise = (async () => {
      const raw = await page.loadText();
      const text = formatText(
        raw ? { fullText: raw.fullText, charRects: [...raw.charRects] } : { fullText: '', charRects: [] },
        pageNumber,
      );
      this.pageTexts.set(pageNumber, text);
      this.invalidate();
      return text;
    })();
    this.pageTexts.set(pageNumber, promise);
  }

  // ---- Missing-font fallback ----

  /** Queries already processed (or failed), keyed independently of the document. */
  private readonly attemptedFontKeys = new Set<string>();
  /** Download cache so several queries resolving to the same file fetch once. */
  private readonly fontDownloads = new Map<string, Promise<Uint8Array | null>>();
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
        await this.engine.addFontData(query.face, data, resolution.resolvedFace);
        console.info(`pdfrx: font fallback "${query.face}" -> "${resolution.resolvedFace}" (${data.length} bytes)`);
        registered++;
      } catch (e) {
        console.warn('pdfrx: font fallback failed for', query, e);
      }
    }
    if (registered === 0 || this.disposed) return;

    await this.engine.reloadFonts();
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
        await this.setDocument(await this.engine.openUrl(source.url, source.options));
      } else {
        await this.setDocument(await this.engine.openData(source.data, source.options));
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
    const promise = page.loadLinks().then((links) => {
      this.pageLinks.set(pageNumber, links);
      this.invalidate();
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
    if (link.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } else if (link.dest) {
      this.goToDest(link.dest);
    }
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
    this.invalidate();
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
    this.canvas.focus({ preventScroll: true });
    this.lastPointerType = e.pointerType;
    this.hideContextMenu();
    this.stopFling();
    this.velocitySamples.length = 0;
    const local = this.localPoint(e);

    // Second pointer while panning -> pinch
    if (this.mode.kind === 'pan' && e.pointerType === 'touch') {
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
    this.mode = { kind: 'pan', pointerId: e.pointerId, lastX: local.x, lastY: local.y, moved: false, startedAt: e.timeStamp };
    if (e.pointerType === 'touch') {
      this.startLongPress(docPoint);
    }
  };

  private startLongPress(docPoint: Offset): void {
    this.cancelLongPress();
    this.longPressTimer = setTimeout(() => {
      if (this.mode.kind === 'pan' && !this.mode.moved) {
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
        const dx = local.x - this.mode.lastX;
        const dy = local.y - this.mode.lastY;
        if (!this.mode.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        this.mode.moved = true;
        this.cancelLongPress();
        this.mode.lastX = local.x;
        this.mode.lastY = local.y;
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
            this.handleTap(this.localPoint(e));
          } else if (e.pointerType === 'touch') {
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
  };

  /** Tap (press without move): open a link if hit, otherwise clear the selection. */
  private handleTap(local: Offset): void {
    const link = this.linkAt(viewToDocument(this.transform, local));
    if (link) {
      this.openLink(link.link);
      return;
    }
    this.clearSelection();
  }

  private readonly onDoubleClick = (e: MouseEvent): void => {
    const docPoint = viewToDocument(this.transform, this.localPoint(e));
    const word = selectWordAt(docPoint, this.selectablePages());
    if (word) {
      this.selA = word.selA;
      this.selB = word.selB;
      this.showHandles = this.lastPointerType === 'touch';
      this.updateAnchors();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.hideContextMenu();
    this.stopFling();
    const local = this.localPoint(e);
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(local, this.transform.zoom * Math.exp(-e.deltaY * 0.002));
    } else {
      this.setTransform({
        zoom: this.transform.zoom,
        xZoomed: this.transform.xZoomed - e.deltaX,
        yZoomed: this.transform.yZoomed - e.deltaY,
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
      if (cmd && e.key.toLowerCase() === 'c') {
        void this.copySelection();
        return true;
      }
      if (cmd && e.key.toLowerCase() === 'a') {
        void this.selectAll();
        return true;
      }
      switch (e.key) {
        case 'Escape':
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
          this.scrollByKey(0, k);
          return true;
        case 'ArrowUp':
          this.scrollByKey(0, -k);
          return true;
        case 'ArrowLeft':
          this.scrollByKey(-k, 0);
          return true;
        case 'ArrowRight':
          this.scrollByKey(k, 0);
          return true;
        case '+':
        case '=':
          if (cmd) {
            this.setZoom(this.transform.zoom * 1.2);
            return true;
          }
          return false;
        case '-':
          if (cmd) {
            this.setZoom(this.transform.zoom / 1.2);
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

  /** Scroll the view content; positive dy scrolls down (like arrow-down). */
  private scrollByKey(dx: number, dy: number): void {
    this.setTransform({
      zoom: this.transform.zoom,
      xZoomed: this.transform.xZoomed - dx,
      yZoomed: this.transform.yZoomed - dy,
    });
  }

  // -------------------------------------------------------------------------
  // Context menu (DOM chrome)
  // -------------------------------------------------------------------------

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    this.showContextMenu(this.localPoint(e));
  };

  private showContextMenuNearSelection(): void {
    if (!this.anchors) return;
    const p = documentToView(this.transform, anchorPoint(this.anchors.b));
    this.showContextMenu({ x: p.x + 8, y: p.y + 8 });
  }

  private showContextMenu(viewPos: Offset): void {
    this.hideContextMenu();
    const menu = document.createElement('div');
    menu.style.cssText =
      'position:absolute;z-index:10;background:#fff;color:#111;border:1px solid #ccc;border-radius:6px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.25);font:13px system-ui,sans-serif;padding:4px;min-width:130px;' +
      'display:flex;flex-direction:column;user-select:none;';
    const addItem = (label: string, enabled: boolean, action: () => void): void => {
      const item = document.createElement('button');
      item.textContent = label;
      item.disabled = !enabled;
      item.style.cssText =
        'all:unset;padding:6px 12px;border-radius:4px;cursor:pointer;' +
        (enabled ? '' : 'color:#aaa;cursor:default;');
      if (enabled) {
        item.addEventListener('mouseenter', () => (item.style.background = '#eee'));
        item.addEventListener('mouseleave', () => (item.style.background = ''));
        item.addEventListener('click', action);
      }
      menu.appendChild(item);
    };
    addItem('Copy', !!(this.selA && this.selB), () => {
      void this.copySelection().then(() => this.clearSelection());
    });
    addItem('Select All', true, () => {
      this.hideContextMenu();
      void this.selectAll();
    });
    this.container.appendChild(menu);
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const x = Math.max(4, Math.min(viewPos.x, this.viewSize.width - mw - 4));
    const y = Math.max(4, Math.min(viewPos.y, this.viewSize.height - mh - 4));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    this.menuEl = menu;
  }

  private hideContextMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

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

  private paint(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const t = this.transform;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.options.backgroundColor ?? '#808080';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.layout || !this.doc || !this.cache) return;

    const visible = calcVisibleRect(t, this.viewSize);

    // Cache maintenance for visible pages
    const visiblePages = new Set<number>();
    const requiredScale = t.zoom * dpr;
    for (let i = 0; i < this.layout.pageLayouts.length; i++) {
      const pageRect = this.layout.pageLayouts[i]!;
      if (!rectOverlaps(pageRect, visible)) continue;
      const pageNumber = i + 1;
      visiblePages.add(pageNumber);
      this.cache.requestBase(pageNumber, requiredScale);
      this.ensureText(pageNumber);
      this.ensureLinks(pageNumber);
      if (requiredScale > this.cache.baseScaleCap(pageNumber) * 1.1) {
        const visibleOnPage = rectIntersect(pageRect, visible);
        if (!rectIsEmpty(visibleOnPage)) {
          this.cache.schedulePatch(pageNumber, visibleOnPage, pageRect, requiredScale);
        }
      }
    }
    this.cache.clearPatchesExcept(visiblePages);

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
          ctx.fillStyle = match === currentMatch ? 'rgba(255, 152, 0, 0.5)' : 'rgba(255, 235, 59, 0.5)';
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
