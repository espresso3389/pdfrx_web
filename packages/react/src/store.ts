import type { PdfPasswordProvider } from '@pdfrx/engine';
import {
  PdfrxViewer,
  type ContextMenuContext,
  type PdfTextSearcher,
  type PdfrxViewerOptions,
  type StartTextSearchOptions,
} from '@pdfrx/viewer';
import { buildDefaultContextMenu, type PdfReactContextMenuBuilder } from './context-menu.js';
import { imageBytesToPdf, looksLikePdf } from './file-open.js';
import { normalizeSource, sourceKey, toBytes, type NormalizedPdfSource, type PdfSource } from './source.js';
import { defaultPdfrxStrings, type PdfrxStrings } from './strings.js';
import { ThumbnailCache } from './thumbnail-cache.js';

/**
 * Owns one {@link PdfrxViewer} instance on behalf of a React tree.
 *
 * React cannot construct the viewer itself, because `new PdfrxViewer(container)`
 * needs a DOM node that only exists once {@link PdfViewerSurface} has rendered —
 * which is a *descendant* of the provider. So the provider creates this store,
 * the surface calls {@link attach} with its `<div>`, and every hook subscribes
 * here. The store is a plain object with no React dependency, which also makes
 * it straightforward to test.
 *
 * Instances are created by `PdfrxProvider`; you normally reach one through
 * `usePdfrxStore()` rather than constructing it.
 */
export class PdfrxViewerStore {
  #viewer: PdfrxViewer | null = null;
  #element: HTMLElement | null = null;
  /**
   * Set between `detach()` and the microtask that actually disposes. React's
   * StrictMode mounts, unmounts and remounts every effect in development; if we
   * disposed synchronously, every dev-mode mount would boot (and throw away) a
   * whole pdfium worker + WASM instance. Deferring by a microtask lets the
   * immediate remount reclaim the same viewer.
   */
  #pendingDispose: PdfrxViewer | null = null;
  #listeners = new Set<() => void>();

  /**
   * The options object handed to the viewer. The viewer reads most fields live
   * on every use, so mutating this in place is how prop changes take effect
   * without recreating the viewer (and its worker).
   */
  #options: PdfrxViewerOptions = {};

  /** The active strings, so the default context menu can be localized. */
  #strings: PdfrxStrings = defaultPdfrxStrings;
  /** An app-supplied context-menu builder, or `null` for the localized default. */
  #userContextMenuBuilder: PdfReactContextMenuBuilder | null = null;
  /**
   * The builder handed to the viewer. It reads {@link #strings} and
   * {@link #viewer} at menu-show time (so both stay current) and dispatches to
   * the app's builder if one was provided, otherwise to the localized default.
   */
  #contextMenuBuilder = (context: ContextMenuContext): HTMLElement | null | undefined => {
    const viewer = this.#viewer;
    if (!viewer) return null;
    return this.#userContextMenuBuilder
      ? this.#userContextMenuBuilder(context, { viewer, strings: this.#strings })
      : buildDefaultContextMenu(viewer, this.#strings, context);
  };

  #source: NormalizedPdfSource | null = null;
  #sourceKey: unknown = NO_SOURCE;
  #error: unknown = null;

  /**
   * Default password provider applied to every built-in open (the `src` prop,
   * the file-open button, drag & drop, page insertion) whose source does not
   * carry its own. Set from the `passwordProvider` prop by `PdfrxProvider`.
   */
  #passwordProvider: PdfPasswordProvider | undefined;
  /**
   * Batteries-included fallback used only when {@link #passwordProvider} is
   * unset — `PdfrxViewerApp` registers a localized `window.prompt` here so
   * encrypted documents prompt out of the box, while bare `PdfrxProvider` stays
   * opt-in.
   */
  #fallbackPasswordProvider: PdfPasswordProvider | undefined;
  /** Bumped per open, so a superseded open cannot report its result. */
  #openToken = 0;
  /** Bumped on every document change, so hooks can key per-document caches. */
  #documentGeneration = 0;
  /** Bumped when pages are rearranged within the current document. */
  #pagesRevision = 0;

  #unsubscribeDocumentChange: (() => void) | null = null;
  #unsubscribeRefresh: (() => void) | null = null;
  #unsubscribePagesRearranged: (() => void) | null = null;

  /** Shared by every `usePdfPageThumbnail` under this provider. */
  readonly thumbnails = new ThumbnailCache();

  /**
   * The one searcher for this viewer. `createTextSearcher()` disposes whatever
   * came before it and only the newest one is painted, so the store owns it
   * rather than letting each `usePdfSearch()` call make its own.
   */
  #searcher: PdfTextSearcher | null = null;
  #searchQuery = '';

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------

  /** Subscribes to viewer/error/document changes. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The live viewer, or `null` before {@link PdfViewerSurface} has mounted. */
  get viewer(): PdfrxViewer | null {
    return this.#viewer;
  }

  /** The error thrown by the most recent open attempt, or `null`. */
  get error(): unknown {
    return this.#error;
  }

  /**
   * Clears {@link error} (e.g. when the user dismisses the error banner). A
   * no-op when there is no error. The next open attempt also clears it.
   */
  clearError(): void {
    if (this.#error === null) return;
    this.#error = null;
    this.#notify();
  }

  /** Increments on every document change; useful as a cache key. */
  get documentGeneration(): number {
    return this.#documentGeneration;
  }

  /** Increments when pages are added, removed, rotated or reordered. */
  get pagesRevision(): number {
    return this.#pagesRevision;
  }

  /** Stable snapshot getters, bound for `useSyncExternalStore`. */
  getViewer = (): PdfrxViewer | null => this.#viewer;
  getError = (): unknown => this.#error;

  #notify(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in pdfrx store listener:', e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Viewer lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates the viewer inside `element`. Called by {@link PdfViewerSurface} on
   * mount. Re-attaching the same element (StrictMode's remount) reuses the
   * existing viewer instead of rebuilding the worker.
   */
  attach(element: HTMLElement): void {
    if (this.#pendingDispose && this.#element === element) {
      this.#pendingDispose = null; // StrictMode remount: keep what we have
      return;
    }
    this.#flushDispose();
    if (this.#viewer) return; // a surface is already attached
    this.#element = element;
    // React always owns the viewer's menu hook; app customization goes through
    // #userContextMenuBuilder, which this dispatches to.
    this.#options.contextMenuBuilder = this.#contextMenuBuilder;
    this.#viewer = new PdfrxViewer(element, this.#options);
    this.#searcher = this.#viewer.createTextSearcher();
    this.#unsubscribeDocumentChange = this.#viewer.addDocumentChangeListener(() => {
      this.#documentGeneration++;
      // Everything keyed to the old document is meaningless now: its searcher
      // holds matches into pages that no longer exist, and thumbnail render
      // keys embed the (recyclable) document handle.
      this.#searchQuery = '';
      this.#searcher = this.#viewer?.createTextSearcher() ?? null;
      this.thumbnails.reset(this.#viewer?.document ?? null);
      this.#bindPagesRearranged();
      this.#notify();
    });
    this.#unsubscribeRefresh = this.#viewer.addRefreshListener(() => {
      // The PdfDocument identity may be unchanged, but every hook/cache derived
      // from its contents must observe the explicit viewer refresh.
      this.#documentGeneration++;
      this.#pagesRevision++;
      this.#searcher = this.#viewer?.createTextSearcher() ?? null;
      this.thumbnails.reset(this.#viewer?.document ?? null);
      this.#notify();
    });
    this.#bindPagesRearranged();
    this.#notify();
    if (this.#source) void this.#openCurrent();
  }

  /** Tears the viewer down. Called by {@link PdfViewerSurface} on unmount. */
  detach(): void {
    if (!this.#viewer) return;
    this.#pendingDispose = this.#viewer;
    queueMicrotask(() => this.#flushDispose());
  }

  /**
   * Watches the current document for page edits. `setPages`/`setPage` renumber
   * pages without producing a new document, so nothing else would tell a
   * thumbnail strip or an outline that its page numbers just moved.
   */
  #bindPagesRearranged(): void {
    this.#unsubscribePagesRearranged?.();
    this.#unsubscribePagesRearranged = null;
    const document = this.#viewer?.document;
    if (!document) return;
    this.#unsubscribePagesRearranged = document.addEventListener('pagesRearranged', () => {
      this.#pagesRevision++;
      // Rotating a page changes its render key; drop the bitmap nothing uses now.
      if (this.#viewer) this.thumbnails.prune(this.#viewer);
      this.#notify();
    });
  }

  #flushDispose(): void {
    const viewer = this.#pendingDispose;
    if (!viewer) return;
    this.#pendingDispose = null;
    this.#unsubscribeDocumentChange?.();
    this.#unsubscribeDocumentChange = null;
    this.#unsubscribeRefresh?.();
    this.#unsubscribeRefresh = null;
    this.#unsubscribePagesRearranged?.();
    this.#unsubscribePagesRearranged = null;
    this.#viewer = null;
    this.#element = null;
    this.#searcher = null; // viewer.dispose() disposes it for us
    this.#searchQuery = '';
    this.thumbnails.reset();
    this.#openToken++; // abandon any in-flight open
    viewer.dispose();
    this.#notify();
  }

  // ---------------------------------------------------------------------------
  // Options
  // ---------------------------------------------------------------------------

  /**
   * Merges new option values into the object the viewer reads from. Most options
   * take effect immediately; `engine`, `engineOptions` and `initialFit` are only
   * consulted at construction, so changing those requires remounting the
   * provider.
   */
  updateOptions(options: PdfrxViewerOptions): void {
    const previous = this.#options;
    Object.assign(this.#options, options);
    const viewer = this.#viewer;
    if (!viewer) return;
    // A few options are cached by the viewer rather than read live.
    if (options.layoutDirection && options.layoutDirection !== previous.layoutDirection) {
      viewer.setLayoutDirection(options.layoutDirection);
    }
    if (options.pageOverlaysBuilder !== previous.pageOverlaysBuilder) viewer.refreshOverlays();
    if (options.viewerOverlayBuilder !== previous.viewerOverlayBuilder) viewer.refreshViewerOverlays();
    viewer.invalidatePaint();
  }

  /**
   * Sets the strings the default context menu is built from. Called by the
   * provider; the menu reads the latest value when it opens, so no viewer
   * rebuild is needed.
   */
  setStrings(strings: PdfrxStrings): void {
    this.#strings = strings;
  }

  /**
   * Sets the app's context-menu builder (or `null` for the localized default).
   * Read at menu-show time, so no viewer rebuild is needed.
   */
  setContextMenuBuilder(builder: PdfReactContextMenuBuilder | null | undefined): void {
    this.#userContextMenuBuilder = builder ?? null;
  }

  // ---------------------------------------------------------------------------
  // Text search
  // ---------------------------------------------------------------------------

  /** The searcher for the current viewer, or `null` before one is attached. */
  get searcher(): PdfTextSearcher | null {
    return this.#searcher;
  }

  /** The text currently in the search box. */
  get searchQuery(): string {
    return this.#searchQuery;
  }

  getSearcher = (): PdfTextSearcher | null => this.#searcher;
  getSearchQuery = (): string => this.#searchQuery;

  /**
   * Sets the search text and starts (or clears) the search.
   *
   * `startTextSearch` ignores a pattern identical to the last one, so re-running
   * the same query needs `resetTextSearch()` first — `force` does that for you.
   */
  setSearchQuery(query: string, options?: StartTextSearchOptions & { force?: boolean }): void {
    if (query === this.#searchQuery && !options?.force) return;
    this.#searchQuery = query;
    const searcher = this.#searcher;
    if (searcher) {
      if (options?.force) searcher.resetTextSearch();
      searcher.startTextSearch(query, options);
    }
    this.#notify();
  }

  // ---------------------------------------------------------------------------
  // Document source
  // ---------------------------------------------------------------------------

  /**
   * The effective default password provider: the app-supplied one, or the
   * batteries-included fallback when none was supplied. Used by every built-in
   * open path and read by callers that open outside the store (e.g. importing
   * pages into the current document).
   */
  get passwordProvider(): PdfPasswordProvider | undefined {
    return this.#passwordProvider ?? this.#fallbackPasswordProvider;
  }

  /** Sets the app-supplied default password provider (from the `passwordProvider` prop). */
  setPasswordProvider(provider: PdfPasswordProvider | undefined): void {
    this.#passwordProvider = provider;
  }

  /** Sets the fallback used only when no app password provider was supplied. */
  setFallbackPasswordProvider(provider: PdfPasswordProvider | undefined): void {
    this.#fallbackPasswordProvider = provider;
  }

  /**
   * Declares which document should be shown. A no-op when the source is
   * equivalent to the current one, so passing an inline `src` string on every
   * render does not reopen the document.
   */
  setSource(src: PdfSource): void {
    const normalized = normalizeSource(src);
    const key = sourceKey(normalized);
    if (this.#sourceKey !== NO_SOURCE && key === this.#sourceKey) return;
    this.#sourceKey = key;
    this.#source = normalized;
    void this.#openCurrent();
  }

  /**
   * Opens a document imperatively, bypassing the `src` prop. Rejects with the
   * open error (which is also recorded on {@link error}).
   */
  async open(src: PdfSource): Promise<void> {
    const normalized = normalizeSource(src);
    this.#sourceKey = sourceKey(normalized);
    this.#source = normalized;
    const error = await this.#openCurrent();
    if (error !== null) throw error;
  }

  /** Opens {@link #source}; records and returns the error rather than throwing. */
  async #openCurrent(): Promise<unknown> {
    const viewer = this.#viewer;
    const source = this.#source;
    const token = ++this.#openToken;
    if (this.#error !== null) {
      this.#error = null;
      this.#notify();
    }
    // No viewer yet: attach() replays this once the surface mounts.
    if (!viewer || !source) return null;
    // Apply the default password provider unless the source carries its own
    // (spreading `source.options` last lets a per-source provider win).
    const provider = this.passwordProvider;
    try {
      if (source.kind === 'url') {
        await viewer.openUrl(source.url, provider ? { passwordProvider: provider, ...source.options } : source.options);
      } else {
        const options = provider ? { passwordProvider: provider, ...source.options } : source.options;
        const bytes = await toBytes(source.data);
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (looksLikePdf(u8)) {
          await viewer.openData(bytes, options);
        } else {
          // Not a PDF — treat it as an image and show it as a one-page PDF. The
          // converted bytes become the viewer's source (so a font-fallback
          // reopen replays the PDF, not the image).
          await viewer.openData(await imageBytesToPdf(viewer.engine, u8), options);
        }
      }
      return null;
    } catch (e) {
      if (token !== this.#openToken) return null; // superseded or disposed
      this.#error = e;
      this.#notify();
      return e;
    }
  }
}

/** Distinguishes "no source has ever been set" from "the source is `null`". */
const NO_SOURCE = Symbol('no-source');
