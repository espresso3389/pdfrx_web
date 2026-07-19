import { WorkerCommunicator, type WorkerCommunicatorOptions } from './communicator.js';
import {
  isWireError,
  PdfErrorCode,
  type WireDest,
  type WireDocument,
  type WireFontQueries,
  type WireOutlineNode,
  type WirePageInfo,
  type WireRect,
} from './protocol.js';
import {
  annotationRenderingModeToIndex,
  PdfImage,
  PdfPasswordException,
  pdfPageRotationFromIndex,
  type PdfAnnotationRenderingMode,
  type PdfDest,
  type PdfDocumentEventMap,
  type PdfDocumentEventName,
  type PdfDownloadProgressCallback,
  type PdfFontQuery,
  type PdfLink,
  type PdfOutlineNode,
  type PdfPageRawText,
  type PdfPageRotation,
  type PdfPasswordProvider,
  type PdfPermissions,
  type PdfRect,
} from './types.js';

/** Options for constructing a {@link PdfrxEngine} (currently the same as {@link WorkerCommunicatorOptions}). */
export interface PdfrxEngineOptions extends WorkerCommunicatorOptions {}

/** Common options for the document-opening methods of {@link PdfrxEngine}. */
export interface PdfOpenOptions {
  /** Supplies passwords for encrypted documents; see {@link PdfPasswordProvider} for retry semantics. */
  passwordProvider?: PdfPasswordProvider;
  /** Try an empty password before consulting `passwordProvider`. Default: true. */
  firstAttemptByEmptyPassword?: boolean;
  /** Load only the first page eagerly; call `PdfDocument.loadPagesProgressively` for the rest. */
  useProgressiveLoading?: boolean;
  /** Identifier used in error messages and for caching purposes. */
  sourceName?: string;
}

/** Options for {@link PdfrxEngine.openUrl}; extends {@link PdfOpenOptions} with fetch-related settings. */
export interface PdfOpenUrlOptions extends PdfOpenOptions {
  /** Invoked as the document downloads (see {@link PdfDownloadProgressCallback}). */
  progressCallback?: PdfDownloadProgressCallback;
  /**
   * Access the file via HTTP range requests instead of downloading it whole.
   * Requires a CORS-enabled server that honors range requests.
   */
  preferRangeAccess?: boolean;
  /** Extra HTTP headers for the fetch (e.g. authorization). */
  headers?: Record<string, string>;
  /** Whether the fetch includes credentials (cookies, HTTP auth). */
  withCredentials?: boolean;
}

/**
 * Options for {@link PdfPage.render}.
 *
 * The page is conceptually scaled to `fullWidth` x `fullHeight` pixels, and the
 * `x`/`y`/`width`/`height` sub-rectangle of that scaled page is what gets
 * rendered. All values are in pixels unless noted otherwise.
 */
export interface PdfPageRenderOptions {
  /** Left of the rendered region in the scaled page (pixels). Default: 0. */
  x?: number;
  /** Top of the rendered region in the scaled page (pixels). Default: 0. */
  y?: number;
  /** Width of the rendered region (pixels). Default: `fullWidth`. */
  width?: number;
  /** Height of the rendered region (pixels). Default: `fullHeight`. */
  height?: number;
  /** Width the whole page is scaled to (pixels). Default: page width in points. */
  fullWidth?: number;
  /** Height the whole page is scaled to (pixels). Default: page height in points. */
  fullHeight?: number;
  /** 32-bit ARGB background. Default: opaque white. */
  backgroundColor?: number;
  /** Absolute rotation override for this render (in addition to the page's own rotation). */
  rotationOverride?: PdfPageRotation;
  /** Whether/how annotations are drawn. Default: `'annotationAndForms'`. */
  annotationRenderingMode?: PdfAnnotationRenderingMode;
  /** Advanced: low-level renderer flags (`FPDF_*`). */
  flags?: number;
}

/**
 * Entry point to the rendering engine.
 *
 * Construct one with the URL of the directory hosting the bundled WASM assets,
 * then open documents with {@link openUrl}, {@link openData},
 * {@link createNew}, or {@link createFromJpegData}. A single engine owns one
 * worker ({@link WorkerCommunicator}) shared by all documents it opens;
 * call {@link dispose} to tear it down.
 *
 * @example
 * ```ts
 * const engine = new PdfrxEngine({ wasmModulesUrl: '/assets/pdfrx/' });
 * const doc = await engine.openUrl('https://example.com/doc.pdf');
 * const image = await doc.pages[0].render({ fullWidth: 1000, fullHeight: 1414 });
 * if (image) {
 *   canvas.getContext('2d')!.putImageData(image.toImageData(), 0, 0);
 * }
 * const text = await doc.pages[0].loadText();
 * console.log(text?.fullText);
 * await doc.dispose();
 * engine.dispose();
 * ```
 */
export class PdfrxEngine {
  private communicator: WorkerCommunicator | null = null;
  private readonly options: PdfrxEngineOptions;

  constructor(options: PdfrxEngineOptions) {
    this.options = options;
  }

  /** Spawns the worker and initializes the engine. Called implicitly by the open functions. */
  async init(): Promise<void> {
    if (!this.communicator) {
      this.communicator = new WorkerCommunicator(this.options);
    }
    await this.communicator.ready;
  }

  /**
   * The active communicator, or throws if {@link init} has not run.
   * @internal
   */
  private get comm(): WorkerCommunicator {
    if (!this.communicator) throw new Error('PdfrxEngine is not initialized');
    return this.communicator;
  }

  /** Terminates the worker; all documents opened by this engine become unusable. */
  dispose(): void {
    this.communicator?.dispose();
    this.communicator = null;
  }

  /**
   * Opens a document from in-memory PDF bytes.
   *
   * The bytes are copied into a fresh `ArrayBuffer` (transferred to the worker)
   * unless `data` is already a full, offset-zero `ArrayBuffer`.
   */
  async openData(data: Uint8Array | ArrayBuffer, options: PdfOpenOptions = {}): Promise<PdfDocument> {
    await this.init();
    const buffer =
      data instanceof ArrayBuffer
        ? data
        : data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer
          ? data.buffer
          : data.slice().buffer;
    return await this.openByFunc(
      (password) =>
        this.comm.sendCommand('loadDocumentFromData', {
          data: buffer,
          password,
          useProgressiveLoading: options.useProgressiveLoading ?? false,
        }),
      options,
      options.sourceName ?? `data%${buffer.byteLength}`,
      null,
    );
  }

  /**
   * Opens a document by URL. The worker fetches the bytes, so the URL must be
   * reachable under the page's CORS policy; relative URLs are resolved against
   * `document.baseURI`. Set {@link PdfOpenUrlOptions.preferRangeAccess} to stream
   * the file via range requests.
   */
  async openUrl(url: string | URL, options: PdfOpenUrlOptions = {}): Promise<PdfDocument> {
    await this.init();
    // The worker runs on a blob: URL, so relative URLs must be resolved here.
    const urlString = new URL(url, document.baseURI).toString();

    let progressCallbackId: number | undefined;
    const cleanup = () => {
      if (progressCallbackId !== undefined) this.comm.unregisterCallback(progressCallbackId);
    };
    if (options.progressCallback) {
      const progressCallback = options.progressCallback;
      progressCallbackId = this.comm.registerCallback((bytesReceived: number, bytesTotal: number) =>
        progressCallback(bytesReceived, bytesTotal),
      );
    }

    try {
      return await this.openByFunc(
        (password) =>
          this.comm.sendCommand('loadDocumentFromUrl', {
            url: urlString,
            password,
            useProgressiveLoading: options.useProgressiveLoading ?? false,
            ...(progressCallbackId !== undefined ? { progressCallbackId } : {}),
            preferRangeAccess: options.preferRangeAccess ?? false,
            ...(options.headers ? { headers: options.headers } : {}),
            withCredentials: options.withCredentials ?? false,
          }),
        options,
        options.sourceName ?? `uri%${urlString}`,
        cleanup,
      );
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  /** Creates a new empty document. */
  async createNew(sourceName = 'new'): Promise<PdfDocument> {
    await this.init();
    const result = await this.comm.sendCommand('createNewDocument', {});
    if (isWireError(result)) {
      throw new Error(`Failed to create new document: ${result.errorCodeStr} (${result.errorCode})`);
    }
    return new PdfDocument(this.comm, result, sourceName, null);
  }

  /**
   * Creates a single-page document that displays the given JPEG image.
   * `size.width`/`size.height` are the page dimensions in points (1/72 inch).
   */
  async createFromJpegData(
    jpegData: Uint8Array,
    size: { width: number; height: number },
    sourceName = 'jpeg',
  ): Promise<PdfDocument> {
    await this.init();
    const buffer = jpegData.slice().buffer;
    const result = await this.comm.sendCommand(
      'createDocumentFromJpegData',
      { jpegData: buffer, width: size.width, height: size.height },
      [buffer],
    );
    if (isWireError(result)) {
      throw new Error(`Failed to create document from JPEG data: ${result.errorCodeStr} (${result.errorCode})`);
    }
    return new PdfDocument(this.comm, result, sourceName, null);
  }

  /** Registers font data used to substitute missing fonts, then re-render affected pages. */
  async addFontData(face: string, data: Uint8Array, resolvedFace?: string): Promise<void> {
    await this.init();
    const buffer = data.slice().buffer;
    await this.comm.sendCommand(
      'addFontData',
      { face, data: buffer, ...(resolvedFace !== undefined ? { resolvedFace } : {}) },
      [buffer],
    );
  }

  /** Re-applies registered font data across the worker (e.g. after adding fonts). */
  async reloadFonts(): Promise<void> {
    await this.init();
    await this.comm.sendCommand('reloadFonts', { dummy: true });
  }

  /** Discards all font data registered via {@link addFontData}. */
  async clearAllFontData(): Promise<void> {
    await this.init();
    await this.comm.sendCommand('clearAllFontData', { dummy: true });
  }

  /**
   * Drives the password-retry loop shared by {@link openData} and {@link openUrl}.
   *
   * If {@link PdfOpenOptions.firstAttemptByEmptyPassword} is set, the first
   * attempt uses an empty password; thereafter the {@link PdfPasswordProvider}
   * is consulted and the open is retried while the engine reports a password error.
   * Throws {@link PdfPasswordException} if the provider gives up.
   * @internal
   */
  private async openByFunc(
    open: (password: string | null) => Promise<WireDocument | import('./protocol.js').WireError>,
    options: PdfOpenOptions,
    sourceName: string,
    onDispose: (() => void) | null,
  ): Promise<PdfDocument> {
    const firstAttemptByEmptyPassword = options.firstAttemptByEmptyPassword ?? true;
    for (let i = 0; ; i++) {
      let password: string | null = null;
      if (!(firstAttemptByEmptyPassword && i === 0)) {
        password = (await options.passwordProvider?.()) ?? null;
        if (password === null) {
          throw new PdfPasswordException(`No password supplied by passwordProvider (${sourceName})`);
        }
      }

      const result = await open(password);
      if (isWireError(result)) {
        if (result.errorCode === PdfErrorCode.password) continue;
        throw new Error(`Failed to open document ${sourceName}: ${result.errorCodeStr} (${result.errorCode})`);
      }
      const doc = new PdfDocument(this.comm, result, sourceName, onDispose);
      if (!(options.useProgressiveLoading ?? false)) {
        doc.notifyLoadComplete();
      }
      return doc;
    }
  }
}

/**
 * Listener for a document event named `E`.
 * @internal
 */
type Listener<E extends PdfDocumentEventName> = (event: PdfDocumentEventMap[E]) => void;

/**
 * An open PDF document.
 *
 * Obtain instances from the opening methods of {@link PdfrxEngine}; do not
 * construct directly. Always {@link dispose} a document when finished to release
 * the underlying native handles.
 */
export class PdfDocument {
  /** @internal */
  constructor(
    comm: WorkerCommunicator,
    wire: WireDocument,
    /** Identifier of the document's source (e.g. `uri%...` or `data%...`); used in error messages. */
    readonly sourceName: string,
    onDispose: (() => void) | null,
  ) {
    this.comm = comm;
    this.docHandle = wire.docHandle;
    this.formHandle = wire.formHandle;
    this.formInfo = wire.formInfo;
    this.onDispose = onDispose;
    this.permissions = PdfDocument.parsePermissions(wire);
    this._pages = wire.pages.map((p) => new PdfPage(this, p));
    this.updateMissingFonts(wire.missingFonts);
  }

  private readonly comm: WorkerCommunicator;
  /** @internal */
  readonly docHandle: number;
  /** @internal */
  readonly formHandle: number;
  private readonly formInfo: number;
  private readonly onDispose: (() => void) | null;
  private readonly listeners = new Map<PdfDocumentEventName, Set<Listener<PdfDocumentEventName>>>();
  private _pages: PdfPage[];
  private _isDisposed = false;
  private loadLock: Promise<void> = Promise.resolve();

  /** Encryption/permission info, or `null` if the document is not encrypted. */
  readonly permissions: PdfPermissions | null;

  /** Whether the document is encrypted (equivalently, {@link permissions} is non-null). */
  get isEncrypted(): boolean {
    return this.permissions !== null;
  }

  /** Whether {@link dispose} has been called; further operations reject. */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /** Pages of the document. With progressive loading, unloaded pages have `isLoaded === false`. */
  get pages(): readonly PdfPage[] {
    return this._pages;
  }

  /**
   * Subscribes to a document event (see {@link PdfDocumentEventMap}) and returns
   * an unsubscribe function.
   *
   * For `missingFonts`, queries already discovered while the document was
   * opening are replayed to the new listener on a microtask, so late
   * subscribers do not miss them.
   */
  addEventListener<E extends PdfDocumentEventName>(
    event: E,
    listener: (event: PdfDocumentEventMap[E]) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<PdfDocumentEventName>);
    // Missing fonts are typically discovered while the document is being
    // opened — before anyone can subscribe. Replay them to new listeners so
    // late subscribers do not miss them.
    if (event === 'missingFonts' && this.accumulatedFontQueries.length > 0) {
      const queries = this.accumulatedFontQueries.slice();
      queueMicrotask(() => {
        if (!this._isDisposed && set.has(listener as Listener<PdfDocumentEventName>)) {
          (listener as Listener<'missingFonts'>)({ queries });
        }
      });
    }
    return () => set.delete(listener as Listener<PdfDocumentEventName>);
  }

  /**
   * Dispatches `payload` to every listener of `event`, isolating listener errors.
   * @internal
   */
  private emit<E extends PdfDocumentEventName>(event: E, payload: PdfDocumentEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as Listener<E>)(payload);
      } catch (e) {
        console.error(`Error in ${event} listener:`, e);
      }
    }
  }

  /** @internal */
  notifyLoadComplete(): void {
    this.emit('loadComplete', {});
  }

  /** All font queries reported so far; replayed to late subscribers. */
  private readonly accumulatedFontQueries: PdfFontQuery[] = [];
  private readonly accumulatedFontKeys = new Set<string>();

  /** @internal */
  updateMissingFonts(missingFonts: WireFontQueries | undefined): void {
    if (!missingFonts) return;
    const entries = Object.values(missingFonts);
    if (entries.length === 0) return;
    const queries: PdfFontQuery[] = entries.map((f) => ({
      face: f.face,
      weight: f.weight,
      isItalic: f.italic,
      charset: f.charset,
      pitchFamily: f.pitchFamily,
    }));
    for (const q of queries) {
      const key = `${q.face}|${q.weight}|${q.isItalic}|${q.charset}|${q.pitchFamily}`;
      if (!this.accumulatedFontKeys.has(key)) {
        this.accumulatedFontKeys.add(key);
        this.accumulatedFontQueries.push(q);
      }
    }
    this.emit('missingFonts', { queries });
  }

  /** @internal */
  sendCommand: WorkerCommunicator['sendCommand'] = (command, parameters, transfer) => {
    if (this._isDisposed) {
      return Promise.reject(new Error(`Document ${this.sourceName} is disposed`));
    }
    return this.comm.sendCommand(command, parameters, transfer);
  };

  /**
   * Closes the document and releases its native handles (and the form
   * environment). Idempotent; after disposal all page operations resolve to
   * `null`/empty or reject. Runs the `onDispose` hook supplied at open time.
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    const promise = this.comm.sendCommand('closeDocument', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      formInfo: this.formInfo,
    });
    this._isDisposed = true;
    this.listeners.clear();
    await promise;
    this.onDispose?.();
  }

  /**
   * True if `other` is a {@link PdfDocument} backed by the same native handle.
   * Note this compares handles, not document contents.
   */
  isIdenticalDocumentHandle(other: unknown): boolean {
    return other instanceof PdfDocument && other.docHandle === this.docHandle;
  }

  /** Loads the document outline (bookmarks) as a tree of {@link PdfOutlineNode}. */
  async loadOutline(): Promise<PdfOutlineNode[]> {
    const result = await this.sendCommand('loadOutline', { docHandle: this.docHandle });
    return result.outline.map((node) => PdfDocument.outlineNodeFromWire(node));
  }

  /**
   * Recursively converts a wire outline node to the public {@link PdfOutlineNode}.
   * @internal
   */
  private static outlineNodeFromWire(node: WireOutlineNode): PdfOutlineNode {
    return {
      title: node.title,
      dest: pdfDestFromWire(node.dest),
      children: node.children.map((child) => PdfDocument.outlineNodeFromWire(child)),
    };
  }

  /**
   * Loads remaining pages in chunks of roughly `loadUnitDurationMs` worth of work.
   * `onPageLoadProgress` can return `false` to stop loading further pages.
   */
  async loadPagesProgressively(
    onPageLoadProgress?: (loadedPageCount: number, totalPageCount: number) => boolean | Promise<boolean>,
    loadUnitDurationMs = 250,
  ): Promise<void> {
    if (this._isDisposed) return;
    await this.synchronized(async () => {
      let firstPageIndex = this._pages.findIndex((page) => !page.isLoaded);
      if (firstPageIndex < 0) return;

      while (firstPageIndex < this._pages.length) {
        if (this._isDisposed) return;
        const result = await this.sendCommand('loadPagesProgressively', {
          docHandle: this.docHandle,
          firstPageIndex,
          loadUnitDuration: loadUnitDurationMs,
        });
        const loaded = result.pages.map((p) => new PdfPage(this, p));
        this.replacePages(loaded);
        firstPageIndex += loaded.length;
        this.updateMissingFonts(result.missingFonts);

        if (onPageLoadProgress && !(await onPageLoadProgress(firstPageIndex, this._pages.length))) {
          break;
        }
      }
      if (firstPageIndex >= this._pages.length) {
        this.notifyLoadComplete();
      }
    });
  }

  /** Reloads page metadata (e.g. after document modification). */
  async reloadPages(pageNumbersToReload?: number[]): Promise<void> {
    if (this._isDisposed) return;
    await this.synchronized(async () => {
      const result = await this.sendCommand('reloadPages', {
        docHandle: this.docHandle,
        ...(pageNumbersToReload ? { pageIndices: pageNumbersToReload.map((n) => n - 1) } : {}),
        currentPagesCount: this._pages.length,
      });
      this.replacePages(result.pages.map((p) => new PdfPage(this, p)));
      this.updateMissingFonts(result.missingFonts);
    });
  }

  /**
   * Replaces the given page slots in-place and emits `pageStatusChanged`.
   * @internal
   */
  private replacePages(updated: PdfPage[]): void {
    if (updated.length === 0) return;
    const pages = this._pages.slice();
    const pageNumbers: number[] = [];
    for (const page of updated) {
      pages[page.pageNumber - 1] = page;
      pageNumbers.push(page.pageNumber);
    }
    this._pages = pages;
    this.emit('pageStatusChanged', { pageNumbers });
  }

  /**
   * Serializes the document back to PDF bytes.
   *
   * NOTE: page reassembly (`assemble`) is not supported yet; this encodes the
   * document as-is.
   */
  async encodePdf(options: { incremental?: boolean; removeSecurity?: boolean } = {}): Promise<Uint8Array> {
    const result = await this.sendCommand('encodePdf', {
      docHandle: this.docHandle,
      incremental: options.incremental ?? false,
      removeSecurity: options.removeSecurity ?? false,
    });
    return new Uint8Array(result.data);
  }

  /**
   * Serializes `action` against previously scheduled page-loading work so that
   * {@link loadPagesProgressively} and {@link reloadPages} never overlap.
   * @internal
   */
  private synchronized<T>(action: () => Promise<T>): Promise<T> {
    const run = this.loadLock.then(action);
    this.loadLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Builds {@link PdfPermissions} from wire fields, or `null` for unencrypted docs.
   * @internal
   */
  private static parsePermissions(wire: WireDocument): PdfPermissions | null {
    if (wire.permissions >= 0 && wire.securityHandlerRevision >= 0) {
      return { permissions: wire.permissions, securityHandlerRevision: wire.securityHandlerRevision };
    }
    return null;
  }
}

/**
 * A page of a document. Obtain instances via {@link PdfDocument.pages}; do not
 * construct directly.
 */
export class PdfPage {
  /** @internal */
  constructor(
    /** The document this page belongs to. */
    readonly document: PdfDocument,
    wire: WirePageInfo,
  ) {
    this.pageNumber = wire.pageIndex + 1;
    this.width = wire.width;
    this.height = wire.height;
    this.rotation = pdfPageRotationFromIndex(wire.rotation);
    this.isLoaded = wire.isLoaded;
    this.bbLeft = wire.bbLeft;
    this.bbBottom = wire.bbBottom;
  }

  /** 1-based page number. */
  readonly pageNumber: number;
  /** Page width in points (1/72 inch). */
  readonly width: number;
  /** Page height in points (1/72 inch). */
  readonly height: number;
  /** Page rotation baked into the PDF (clockwise). */
  readonly rotation: PdfPageRotation;
  /** False for pages not yet materialized during progressive loading. */
  readonly isLoaded: boolean;
  /** Left of the page's bounding box; text/link rects are shifted by it in {@link rectFromWire}. @internal */
  private readonly bbLeft: number;
  /** Bottom of the page's bounding box; text/link rects are shifted by it in {@link rectFromWire}. @internal */
  private readonly bbBottom: number;

  /**
   * Renders (a part of) the page to a {@link PdfImage} of RGBA8888 pixels
   * (Canvas/WebGL-ready; the worker converts from the engine's native BGRA).
   *
   * The page is scaled to `fullWidth` x `fullHeight` (defaulting to the page
   * size in points, i.e. 72 dpi) and the `x`/`y`/`width`/`height` sub-region of
   * that scaled page is returned. Use {@link PdfImage.toImageData} /
   * {@link PdfImage.toImageBitmap} to draw the result. Returns `null` if the
   * document is already disposed.
   */
  async render(options: PdfPageRenderOptions = {}): Promise<PdfImage | null> {
    if (this.document.isDisposed) return null;
    const fullWidth = options.fullWidth ?? this.width;
    const fullHeight = options.fullHeight ?? this.height;
    const width = options.width ?? Math.floor(fullWidth);
    const height = options.height ?? Math.floor(fullHeight);

    const result = await this.document.sendCommand('renderPage', {
      docHandle: this.document.docHandle,
      pageIndex: this.pageNumber - 1,
      x: options.x ?? 0,
      y: options.y ?? 0,
      width,
      height,
      fullWidth,
      fullHeight,
      backgroundColor: options.backgroundColor ?? 0xffffffff,
      rotation:
        options.rotationOverride !== undefined
          ? (options.rotationOverride / 90 - this.rotation / 90 + 4) & 3
          : 0,
      annotationRenderingMode: annotationRenderingModeToIndex(options.annotationRenderingMode ?? 'annotationAndForms'),
      flags: options.flags ?? 0,
      formHandle: this.document.formHandle,
    });
    this.document.updateMissingFonts(result.missingFonts);
    return new PdfImage(width, height, new Uint8Array(result.imageData));
  }

  /**
   * Loads the full text of the page with one bounding rect per UTF-16 code unit
   * (in page coordinates). Returns `null` if the document is disposed or the
   * page is not yet loaded (progressive loading).
   */
  async loadText(): Promise<PdfPageRawText | null> {
    if (this.document.isDisposed || !this.isLoaded) return null;
    const result = await this.document.sendCommand('loadText', {
      docHandle: this.document.docHandle,
      pageIndex: this.pageNumber - 1,
    });
    this.document.updateMissingFonts(result.missingFonts);
    return {
      fullText: result.fullText,
      charRects: result.charRects.map((r) => this.rectFromWire(r)),
    };
  }

  /**
   * Loads link annotations on the page and, when
   * `enableAutoLinkDetection` is true (the default), URL-like text detected in
   * the page content. Returns an empty array if the document is disposed or the
   * page is not yet loaded.
   */
  async loadLinks(options: { enableAutoLinkDetection?: boolean } = {}): Promise<PdfLink[]> {
    if (this.document.isDisposed || !this.isLoaded) return [];
    const result = await this.document.sendCommand('loadLinks', {
      docHandle: this.document.docHandle,
      pageIndex: this.pageNumber - 1,
      enableAutoLinkDetection: options.enableAutoLinkDetection ?? true,
    });
    return result.links.map((link) => ({
      rects: link.rects.map((r) => this.rectFromWire(r)),
      url: link.url ?? null,
      dest: pdfDestFromWire(link.dest),
      annotation: link.annotation
        ? {
            title: link.annotation.title ?? null,
            content: link.annotation.content ?? null,
            subject: link.annotation.subject ?? null,
            modificationDate: link.annotation.modificationDate ?? null,
            creationDate: link.annotation.creationDate ?? null,
          }
        : null,
    }));
  }

  /**
   * Converts a wire rect (raw page coordinates) to a {@link PdfRect} relative to
   * the page's bounding-box origin ({@link bbLeft} / {@link bbBottom}).
   * @internal
   */
  private rectFromWire(r: WireRect): PdfRect {
    return {
      left: r[0] - this.bbLeft,
      top: r[1] - this.bbBottom,
      right: r[2] - this.bbLeft,
      bottom: r[3] - this.bbBottom,
    };
  }
}

/**
 * Converts a wire destination (0-based page index) to a public {@link PdfDest}
 * (1-based page number), or `null` if absent.
 */
function pdfDestFromWire(dest: WireDest | null | undefined): PdfDest | null {
  if (!dest) return null;
  return {
    pageNumber: dest.pageIndex + 1,
    command: dest.command,
    params: dest.params,
  };
}
