import { WorkerCommunicator, type WorkerCommunicatorOptions } from './communicator.js';
import { evaluateCalc, parseCalcAction, type FormCalcSpec } from './form-calc.js';
import {
  imageSourcesToWirePages,
  type PdfCreateFromImagesOptions,
  type PdfImageSource,
} from './image-source.js';
import { PdfPageRenderCancellationToken } from './render-queue.js';
import {
  isWireError,
  PdfErrorCode,
  type WireAnnotationGeometry,
  type WireAnnotationObject,
  type WireAnnotationSpec,
  type WireColor,
  type WireDest,
  type WireDocument,
  type WireFontQueries,
  type WireFormField,
  type WireFormNotification,
  type WireOutlineNode,
  type WirePageInfo,
  type WireRect,
} from './protocol.js';
import {
  annotationRenderingModeToIndex,
  decodeFormFieldFlags,
  pdfAnnotationSubtypeFromName,
  PdfImage,
  PdfPasswordException,
  pdfFormFieldTypeFromCode,
  pdfPageRotationFromIndex,
  pdfPageRotationToIndex,
  type PdfAnnotationColor,
  type PdfAnnotationGeometry,
  type PdfAnnotationObject,
  type PdfAnnotationPoint,
  type PdfAnnotationQuad,
  type PdfAnnotationRenderingMode,
  type PdfAnnotationSpec,
  type PdfAnnotationSubtype,
  type PdfDest,
  type PdfDocumentEventMap,
  type PdfDocumentEventName,
  type PdfDownloadProgressCallback,
  type PdfFontQuery,
  type PdfFormField,
  type PdfFormFieldValue,
  type PdfHighlightObject,
  type PdfLink,
  type PdfLoadAnnotationsOptions,
  type PdfLoadHighlightsOptions,
  type PdfOutlineNode,
  type PdfPageRawText,
  type PdfPageRotation,
  type PdfPasswordProvider,
  PdfPermissions,
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
  /**
   * Cancels the render while it is still queued, making it resolve to `null`.
   * Create it with {@link PdfPage.createCancellationToken}.
   */
  cancellationToken?: PdfPageRenderCancellationToken;
}

/**
 * Entry point to the rendering engine.
 *
 * Construct one — in a browser, with the URL of the directory serving the
 * bundled WASM assets; on Node, Bun or Deno, with nothing at all, since the
 * assets ship inside this package — then open documents with {@link openUrl},
 * {@link openData}, {@link createNew}, or {@link createFromImages}. A single
 * engine owns one worker ({@link WorkerCommunicator}) shared by all documents it
 * opens; call {@link dispose} to tear it down.
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

  constructor(options: PdfrxEngineOptions = {}) {
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
   * A `Uint8Array` view over part of a buffer is copied into a fresh
   * `ArrayBuffer` first. The bytes are then handed to the worker by
   * `postMessage`, which copies them again — they are deliberately *not*
   * transferred, because `data` must stay usable: a wrong-password retry
   * re-sends it, and callers such as `PdfrxViewer` reopen from the same bytes
   * after registering fallback fonts.
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
   * {@link WorkerCommunicatorOptions.baseUrl} (`document.baseURI` by default).
   * Set {@link PdfOpenUrlOptions.preferRangeAccess} to stream the file via range
   * requests.
   */
  async openUrl(url: string | URL, options: PdfOpenUrlOptions = {}): Promise<PdfDocument> {
    await this.init();
    // The worker has a base URL of its own (a blob: URL by default), so
    // relative URLs must be resolved here.
    const urlString = new URL(url, this.comm.baseUrl).toString();

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
   * Creates a document with one page per image, in order.
   *
   * Each image is either encoded bytes (a `Blob`, `Uint8Array`, or
   * `ArrayBuffer`) or a {@link PdfRawImage} of already-decoded pixels. JPEG bytes
   * are decoded natively by PDFium on every runtime; other formats are decoded
   * on the calling thread via `createImageBitmap` + `OffscreenCanvas` where
   * available (browsers, workers, Deno, Bun). On runtimes without that (Node),
   * pass {@link PdfCreateFromImagesOptions.decode} or pre-decoded
   * {@link PdfRawImage} pixels.
   *
   * Page size defaults to the image's pixel size at
   * {@link PdfCreateFromImagesOptions.dpi} (72 by default); override it for all
   * pages with {@link PdfCreateFromImagesOptions.pageSize}.
   *
   * @example
   * ```ts
   * // A PNG and a JPEG, one per page:
   * const doc = await engine.createFromImages([pngBlob, jpegBytes]);
   * ```
   */
  async createFromImages(
    images: PdfImageSource[],
    options: PdfCreateFromImagesOptions = {},
  ): Promise<PdfDocument> {
    if (images.length === 0) throw new Error('createFromImages requires at least one image');
    await this.init();
    const { pages, transfer } = await imageSourcesToWirePages(images, options);
    const result = await this.comm.sendCommand('createDocumentFromImages', { pages }, transfer);
    if (isWireError(result)) {
      throw new Error(`Failed to create document from images: ${result.errorCodeStr} (${result.errorCode})`);
    }
    return new PdfDocument(this.comm, result, options.sourceName ?? 'images', null);
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

/** Extracts raw page text covered by a highlight's individual quadpoints. */
const extractHighlightText = (highlight: PdfHighlightObject, pageText: PdfPageRawText | null): string | null => {
  if (!pageText || highlight.geometry.kind !== 'markup') return null;
  const ranges: { start: number; end: number }[] = [];
  for (const quad of highlight.geometry.quads) {
    const points = [quad.topLeft, quad.topRight, quad.bottomLeft, quad.bottomRight];
    const left = Math.min(...points.map((p) => p.x));
    const right = Math.max(...points.map((p) => p.x));
    const bottom = Math.min(...points.map((p) => p.y));
    const top = Math.max(...points.map((p) => p.y));
    let start = -1;
    let end = -1;
    for (let i = 0; i < pageText.charRects.length; i++) {
      const rect = pageText.charRects[i];
      if (!rect) continue;
      const rectLeft = Math.min(rect.left, rect.right);
      const rectRight = Math.max(rect.left, rect.right);
      const rectBottom = Math.min(rect.bottom, rect.top);
      const rectTop = Math.max(rect.bottom, rect.top);
      if (rectRight < left || rectLeft > right || rectTop < bottom || rectBottom > top) continue;
      if (start < 0) start = i;
      end = i + 1;
    }
    if (start >= 0) ranges.push({ start, end });
  }
  if (ranges.length === 0) return '';
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged
    .map((range) => pageText.fullText.substring(range.start, range.end).trim())
    .filter((text) => text.length > 0)
    .join('\n');
};

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
/**
 * One page slot of an arrangement being written back to the PDF: which page to
 * place, from which document, at what rotation.
 * @internal
 */
export interface PdfAssembleSource {
  /**
   * Source document to take the page from. Defaults to the document being
   * assembled; pass another {@link PdfDocument} to import one of its pages.
   */
  document?: PdfDocument;
  /** 1-based page number within {@link document}. */
  pageNumber: number;
  /** Absolute rotation to apply, or `undefined` to keep the source page's own. */
  rotation?: PdfPageRotation;
}

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
    this.nativePageCount = this._pages.length;
    this.updateMissingFonts(wire.missingFonts);
    if (this.formHandle) this.ensureFormNotify();
  }

  /**
   * Registers (once) the worker-side callback that relays form invalidate/change
   * notifications for this document, so interactive edits repaint and
   * `formFieldsChanged` fires. No-op for documents without a form environment.
   * @internal
   */
  private ensureFormNotify(): void {
    if (this.formNotifyCallbackId !== null || !this.formHandle || this._isDisposed) return;
    const callbackId = this.comm.registerCallback((notification: WireFormNotification) =>
      this.handleFormNotification(notification),
    );
    this.formNotifyCallbackId = callbackId;
    // Fire-and-forget: the worker stores the id against this document's form context.
    void this.comm.sendCommand('registerFormNotify', { docHandle: this.docHandle, callbackId }).catch(() => {});
  }

  /**
   * Dispatches a form notification relayed from the worker's form-fill callbacks.
   * @internal
   */
  private handleFormNotification(notification: WireFormNotification): void {
    if (this._isDisposed) return;
    if (notification.kind === 'change') {
      this.emit('formFieldsChanged', { source: 'user' });
      return;
    }
    // invalidate: map the physical page index back onto the arrangement.
    const pageNumber = this.pageNumberOfSourceIndex(notification.pageIndex);
    if (pageNumber === null) return;
    const page = this._pages[pageNumber - 1];
    if (!page) return;
    const rect = page.wireRectToPdf(notification.rect);
    for (const listener of this.formInvalidateListeners) {
      try {
        listener(pageNumber, rect);
      } catch (e) {
        console.error('Error in form invalidate listener:', e);
      }
    }
  }

  /**
   * Reserved for internal use only (the viewer). Subscribes to form dirty-region
   * redraws (page number + rect in PDF page coordinates). Returns an unsubscribe.
   * @internal
   */
  addFormInvalidateListener(listener: (pageNumber: number, rect: PdfRect) => void): () => void {
    this.ensureFormNotify();
    this.formInvalidateListeners.add(listener);
    return () => this.formInvalidateListeners.delete(listener);
  }

  private readonly comm: WorkerCommunicator;
  /**
   * Reserved for internal use only. Native handle of the document in the worker.
   * @internal
   */
  readonly docHandle: number;
  /**
   * Reserved for internal use only. Native handle of the document's form
   * environment in the worker.
   * @internal
   */
  readonly formHandle: number;
  private readonly formInfo: number;
  private readonly onDispose: (() => void) | null;
  private readonly listeners = new Map<PdfDocumentEventName, Set<Listener<PdfDocumentEventName>>>();
  private _pages: PdfPage[];
  /** Number of pages in the underlying PDF, which {@link setPages} can make differ from `_pages.length`. */
  private nativePageCount: number;
  private arrangementDirty = false;
  /** Documents whose pages appear in this one's arrangement (see {@link setPages}). */
  private borrowedFrom = new Set<PdfDocument>();
  /** Documents whose arrangement includes pages of this one; warned about on {@link dispose}. */
  private readonly borrowers = new Set<PdfDocument>();
  private _isDisposed = false;
  private loadLock: Promise<void> = Promise.resolve();
  /** Callback id registered with the worker to relay form invalidate/change notifications. */
  private formNotifyCallbackId: number | null = null;
  /** Internal listeners (the viewer) wanting form dirty-region redraws. */
  private readonly formInvalidateListeners = new Set<(pageNumber: number, rect: PdfRect) => void>();
  /** Cache of field name → physical page index, populated by {@link loadFormFields}. */
  private readonly formFieldSourceIndex = new Map<string, number>();
  /** Lazily-loaded parsed `AFSimple_Calculate` specs (`null` until first needed). */
  private calcSpecs: { name: string; spec: FormCalcSpec }[] | null = null;
  /**
   * Whether {@link setFormFieldValue} recomputes dependent calculated fields
   * (`AFSimple_Calculate`) after a change. Default `true`.
   */
  formCalculationEnabled = true;

  /** Encryption/permission info, or `null` if the document is not encrypted. */
  readonly permissions: PdfPermissions | null;

  /** Whether the document is encrypted (equivalently, `permissions` is non-null). */
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
   * Whether {@link pages} has been rearranged by {@link setPages} / {@link setPage}
   * without the PDF having been rebuilt yet. {@link encodePdf} materializes the
   * arrangement, clearing this.
   */
  get isPageArrangementModified(): boolean {
    return this.arrangementDirty;
  }

  /**
   * Replaces the page arrangement — the one way to reorder, rotate, remove,
   * duplicate, and import pages, and the cheap, synchronous counterpart to
   * {@link assemblePages}.
   *
   * Nothing is sent to the worker and the PDF is not rebuilt: the pages are
   * proxies ({@link PdfPage.rotatedTo}, {@link PdfPage.withPageNumber}) over
   * pages that stay loaded, so reordering and rotating are immediate and free,
   * and undo is just setting the previous array back. This is what GUI page
   * editing wants; call {@link encodePdf} (or {@link assemblePages}) when the
   * arrangement finally has to become a real PDF.
   *
   * Pages may come from other documents — those must stay open for as long as
   * they are referenced. Page numbers are reassigned to match the new order, so
   * callers can pass pages in any arrangement.
   *
   * Fires `pageStatusChanged` for every slot.
   *
   * @example
   * ```ts
   * const p = doc.pages;
   * doc.setPages([p[2]!, p[0]!.rotatedCW90(), p[1]!]); // reorder + rotate
   * doc.setPages(doc.pages.filter((x) => x !== p[2])); // remove
   * doc.setPages([...doc.pages, ...other.pages]);      // import from another doc
   * await doc.encodePdf();                             // now it becomes a PDF
   * ```
   * @throws if `pages` is empty, or a page belongs to a disposed document.
   */
  setPages(pages: readonly PdfPage[]): void {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    if (pages.length === 0) throw new Error('setPages requires at least one page');
    const arranged = pages.map((page, index) => {
      if (page.document.isDisposed) {
        throw new Error(`Page ${index + 1} belongs to disposed document ${page.document.sourceName}`);
      }
      return page.withPageNumber(index + 1);
    });
    this.trackBorrowedDocuments(arranged);
    this._pages = arranged;
    this.arrangementDirty = true;
    const pageNumbers = arranged.map((p) => p.pageNumber);
    this.emit('pageStatusChanged', { pageNumbers });
    this.emit('pagesRearranged', { pageNumbers });
  }

  /**
   * Replaces a single slot (1-based), keeping every other page in place — the
   * common case for GUI editing (`doc.setPage(3, doc.pages[2]!.rotatedCW90())`).
   * Like {@link setPages}, this touches no PDF data.
   */
  setPage(pageNumber: number, page: PdfPage): void {
    if (pageNumber < 1 || pageNumber > this._pages.length) {
      throw new RangeError(`pageNumber ${pageNumber} out of range (1..${this._pages.length})`);
    }
    const pages = this._pages.slice();
    pages[pageNumber - 1] = page;
    this.setPages(pages);
  }

  /**
   * Updates the two-way record of which other documents this arrangement borrows
   * pages from, so that disposing one of them can be reported instead of quietly
   * turning those pages blank.
   * @internal
   */
  private trackBorrowedDocuments(arranged: readonly PdfPage[]): void {
    const lenders = new Set<PdfDocument>();
    for (const page of arranged) {
      if (page.document.docHandle !== this.docHandle) lenders.add(page.document);
    }
    for (const previous of this.borrowedFrom) {
      if (!lenders.has(previous)) previous.borrowers.delete(this);
    }
    for (const lender of lenders) lender.borrowers.add(this);
    this.borrowedFrom = lenders;
  }

  /**
   * Position in {@link pages} (1-based) of the physical page at `sourcePageIndex`,
   * or `null` if the current arrangement does not contain it.
   *
   * This is how destinations from the PDF itself — outline entries and internal
   * links, which PDFium reports as physical page indices — are translated into
   * page numbers callers can navigate to after {@link setPages}.
   *
   * Two caveats are inherent rather than fixable: a page placed twice can only
   * resolve to one position (the first wins), and a page removed from the
   * arrangement has no position at all, so destinations into it become `null`.
   */
  pageNumberOfSourceIndex(sourcePageIndex: number): number | null {
    if (!this.arrangementDirty) {
      // pages[i] is the physical page i, so the mapping is the identity.
      return sourcePageIndex >= 0 && sourcePageIndex < this._pages.length ? sourcePageIndex + 1 : null;
    }
    for (let i = 0; i < this._pages.length; i++) {
      const page = this._pages[i]!;
      if (page.document.docHandle === this.docHandle && page.sourcePageIndex === sourcePageIndex) return i + 1;
    }
    return null;
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

  /**
   * Reserved for internal use only. Fires `loadComplete`; listen for the event
   * with {@link addEventListener} instead.
   * @internal
   */
  notifyLoadComplete(): void {
    this.emit('loadComplete', {});
  }

  /** All font queries reported so far; replayed to late subscribers. */
  private readonly accumulatedFontQueries: PdfFontQuery[] = [];
  private readonly accumulatedFontKeys = new Set<string>();

  /**
   * Reserved for internal use only. Records the fonts the worker reported as
   * missing and fires `missingFonts`; listen for the event with
   * {@link addEventListener} instead.
   * @internal
   */
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

  /**
   * Reserved for internal use only. Sends a raw worker command on behalf of this
   * document, rejecting once it is disposed.
   * @internal
   */
  sendCommand: WorkerCommunicator['sendCommand'] = (command, parameters, transfer) => {
    if (this._isDisposed) {
      return Promise.reject(new Error(`Document ${this.sourceName} is disposed`));
    }
    return this.comm.sendCommand(command, parameters, transfer);
  };

  /**
   * Reserved for internal use only. Use {@link PdfPage.render} for normal purpose.
   *
   * Queues a render on the worker's render queue (shared by every document the
   * engine opened, since the worker is the contended resource).
   * @internal
   */
  enqueueRender<T>(send: () => Promise<T>, token?: PdfPageRenderCancellationToken): Promise<T | null> {
    if (this._isDisposed) return Promise.resolve(null);
    return this.comm.enqueueRender(send, token);
  }

  /**
   * Closes the document and releases its native handles (and the form
   * environment). Idempotent; after disposal all page operations resolve to
   * `null`/empty or reject. Runs the `onDispose` hook supplied at open time.
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    if (this.borrowers.size > 0) {
      const names = [...this.borrowers].map((d) => d.sourceName).join(', ');
      console.warn(
        `pdfrx: disposing ${this.sourceName} while its pages are still placed in ${names} by setPages; ` +
          `those pages will no longer render. Call encodePdf()/assemblePages() on the borrowing ` +
          `document first to copy them in.`,
      );
    }
    for (const lender of this.borrowedFrom) lender.borrowers.delete(this);
    this.borrowedFrom.clear();
    this.borrowers.clear();
    this.formInvalidateListeners.clear();
    if (this.formNotifyCallbackId !== null) {
      this.comm.unregisterCallback(this.formNotifyCallbackId);
      this.formNotifyCallbackId = null;
    }
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
    return result.outline.map((node) => this.outlineNodeFromWire(node));
  }

  /**
   * Recursively converts a wire outline node to the public {@link PdfOutlineNode},
   * mapping physical page indices onto the current arrangement.
   * @internal
   */
  private outlineNodeFromWire(node: WireOutlineNode): PdfOutlineNode {
    return {
      title: node.title,
      dest: pdfDestFromWire(node.dest, this),
      children: node.children.map((child) => this.outlineNodeFromWire(child)),
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
      // Indices here are physical, not positional: after setPages the two differ.
      const unloaded = this._pages.filter((p) => !p.isLoaded && p.document.docHandle === this.docHandle);
      if (unloaded.length === 0) return;
      let firstPageIndex = Math.min(...unloaded.map((p) => p.sourcePageIndex));

      while (firstPageIndex < this.nativePageCount) {
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

        if (onPageLoadProgress && !(await onPageLoadProgress(firstPageIndex, this.nativePageCount))) {
          break;
        }
      }
      if (firstPageIndex >= this.nativePageCount) {
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
        ...(pageNumbersToReload
          ? { pageIndices: pageNumbersToReload.map((n) => this._pages[n - 1]?.sourcePageIndex ?? n - 1) }
          : {}),
        currentPagesCount: this.nativePageCount,
      });
      this.replacePages(result.pages.map((p) => new PdfPage(this, p)));
      this.updateMissingFonts(result.missingFonts);
    });
  }

  /**
   * Merges freshly loaded page metadata into the current arrangement and emits
   * `pageStatusChanged`.
   *
   * `updated` is keyed by physical page index, while {@link pages} is keyed by
   * position, and {@link setPages} may have made the two disagree — so each slot
   * is matched by its source page and re-based, preserving proxy overrides.
   * @internal
   */
  private replacePages(updated: PdfPage[]): void {
    if (updated.length === 0) return;
    const bySourceIndex = new Map(updated.map((p) => [p.sourcePageIndex, p]));
    const pages = this._pages.slice();
    const pageNumbers: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const current = pages[i]!;
      // Imported pages are reloaded by the document that owns them.
      if (current.document.docHandle !== this.docHandle) continue;
      const fresh = bySourceIndex.get(current.sourcePageIndex);
      if (!fresh) continue;
      pages[i] = current.rebasedOn(fresh).withPageNumber(i + 1);
      pageNumbers.push(i + 1);
    }
    if (pageNumbers.length === 0) return;
    this._pages = pages;
    this.emit('pageStatusChanged', { pageNumbers });
  }

  /**
   * Rebuilds `_pages` from scratch after a structural change (assemble), fully
   * resizing the array. Not wrapped in {@link synchronized} — call from within a
   * synchronized block.
   * @internal
   */
  private async refreshAllPages(): Promise<void> {
    const result = await this.sendCommand('reloadPages', {
      docHandle: this.docHandle,
      currentPagesCount: this.nativePageCount,
    });
    const pages = result.pages.map((p) => new PdfPage(this, p));
    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    this._pages = pages;
    this.nativePageCount = pages.length;
    // The PDF now *is* the arrangement: no proxies are outstanding, and any
    // imported pages have been copied in, so nothing is borrowed any more.
    this.arrangementDirty = false;
    this.trackBorrowedDocuments(pages);
    this.updateMissingFonts(result.missingFonts);
    const pageNumbers = pages.map((p) => p.pageNumber);
    this.emit('pageStatusChanged', { pageNumbers });
    this.emit('pagesRearranged', { pageNumbers });
  }

  /**
   * Rewrites the PDF to match the current {@link pages} arrangement, turning the
   * proxies {@link setPages} / {@link setPage} left behind into real pages —
   * pages of other documents are copied in, so the arrangement stops depending
   * on them.
   *
   * Called automatically by {@link encodePdf}; use it directly only when you
   * need the native document itself to be consistent (e.g. before
   * {@link loadOutline} or a raw worker operation). A no-op when the arrangement
   * is unmodified. After the rewrite the pages are reloaded and
   * `pageStatusChanged` fires.
   */
  async assemblePages(): Promise<void> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    if (!this.arrangementDirty) return;
    const sources = this._pages.map((p) => p.toAssembleSource());
    await this.synchronized(async () => {
      const pageIndices: number[] = [];
      const rotations: (number | null)[] = [];
      const importedPages: Record<number, { docHandle: number; pageNumber: number }> = {};
      let nextNegative = -1;
      for (const source of sources) {
        const doc = source.document ?? this;
        if (doc.docHandle === this.docHandle) {
          pageIndices.push(source.pageNumber - 1);
        } else {
          if (doc._isDisposed) throw new Error(`Source document ${doc.sourceName} is disposed`);
          const neg = nextNegative--;
          pageIndices.push(neg);
          importedPages[neg] = { docHandle: doc.docHandle, pageNumber: source.pageNumber - 1 };
        }
        rotations.push(source.rotation === undefined ? null : pdfPageRotationToIndex(source.rotation));
      }
      await this.sendCommand('assemble', {
        docHandle: this.docHandle,
        pageIndices,
        rotations,
        ...(Object.keys(importedPages).length > 0 ? { importedPages } : {}),
      });
      await this.refreshAllPages();
    });
  }

  /**
   * Serializes the document back to PDF bytes, reflecting any page manipulation
   * done with {@link setPages} / {@link setPage}; a pending arrangement is
   * written back with {@link assemblePages} first.
   */
  async encodePdf(options: { incremental?: boolean; removeSecurity?: boolean } = {}): Promise<Uint8Array> {
    await this.assemblePages();
    const result = await this.sendCommand('encodePdf', {
      docHandle: this.docHandle,
      incremental: options.incremental ?? false,
      removeSecurity: options.removeSecurity ?? false,
    });
    return new Uint8Array(result.data);
  }

  /**
   * Serializes the current page arrangement through a temporary document,
   * leaving this document and any outstanding page proxies untouched. The
   * temporary copy is always disposed before this method returns.
   */
  async encodePdfCopy(options: { incremental?: boolean; removeSecurity?: boolean } = {}): Promise<Uint8Array> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    const result = await this.sendCommand('cloneDocument', { docHandle: this.docHandle });
    if (isWireError(result)) {
      throw new Error(`Failed to clone document ${this.sourceName}: ${result.errorCodeStr} (${result.errorCode})`);
    }
    const copy = new PdfDocument(this.comm, result, `${this.sourceName} (copy)`, null);
    try {
      const pages = this._pages.map((page) => {
        if (page.document.docHandle !== this.docHandle) return page;
        const copiedSource = copy.pages[page.sourcePageIndex];
        if (!copiedSource) {
          throw new Error(`Source page ${page.sourcePageIndex + 1} is missing from the document copy`);
        }
        return copiedSource.rotatedTo(page.rotation);
      });
      copy.setPages(pages);
      return await copy.encodePdf(options);
    } finally {
      await copy.dispose();
    }
  }

  /**
   * Loads all AcroForm fields across the document's currently loaded pages,
   * grouped by fully-qualified name (widgets that share a name — e.g. a radio
   * group — merge into one field). Returns an empty array for documents without
   * a form. Reflects live values, including ones changed by
   * {@link setFormFieldValue} or interactive editing.
   */
  async loadFormFields(): Promise<PdfFormField[]> {
    if (this._isDisposed || !this.formHandle) return [];
    const byName = new Map<string, { field: PdfFormField; rects: PdfRect[] }>();
    const ordered: { field: PdfFormField; rects: PdfRect[] }[] = [];
    for (const page of this._pages) {
      if (page.document.docHandle !== this.docHandle) continue; // imported pages carry their own form state
      const fields = await page.loadFormFields();
      for (const field of fields) {
        if (field.name) this.formFieldSourceIndex.set(field.name, page.sourcePageIndex);
        // Merge widgets of the same named field that span pages (rare).
        const existing = field.name ? byName.get(field.name) : undefined;
        if (existing) {
          existing.rects.push(...field.rects);
        } else {
          const entry = { field, rects: [...field.rects] };
          if (field.name) byName.set(field.name, entry);
          ordered.push(entry);
        }
      }
    }
    return ordered.map(({ field, rects }) => ({ ...field, rects }));
  }

  /** Returns the current value of the named field, or `undefined` if it is not found. */
  async getFormFieldValue(name: string): Promise<string | undefined> {
    const fields = await this.loadFormFields();
    return fields.find((f) => f.name === name)?.value;
  }

  /**
   * Sets the value of the field identified by fully-qualified `name`, routed
   * through the form-fill module so the widget appearance regenerates and the
   * change is visible on the next render. When {@link formCalculationEnabled} is
   * set (the default), dependent calculated fields (`AFSimple_Calculate`) are
   * recomputed afterwards. Fires `formFieldsChanged` (`source: 'api'`). The
   * interpretation of `value` depends on the field type — see
   * {@link PdfFormFieldValue}.
   */
  async setFormFieldValue(name: string, value: PdfFormFieldValue): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    await this.sendSetFormFieldValue(name, value);
    if (this.formCalculationEnabled) await this.runFormCalculations();
    this.emit('formFieldsChanged', { source: 'api' });
  }

  /**
   * Loads all content annotations (ink, shapes, text markup, notes, free text —
   * not widgets/links/popups) across the document's loaded pages, each tagged
   * with its 1-based `pageNumber`. Use `options.subtype` to restrict the result
   * to one or more annotation subtypes. Annotations on pages imported from
   * another document are skipped (they carry their own annotation state, like
   * form fields). Returns `[]` for a disposed document.
   */
  async loadAnnotations(options: PdfLoadAnnotationsOptions = {}): Promise<PdfAnnotationObject[]> {
    if (this._isDisposed) return [];
    const all: PdfAnnotationObject[] = [];
    const requestedSubtypes = options.subtype === undefined
      ? null
      : new Set(Array.isArray(options.subtype) ? options.subtype : [options.subtype]);
    for (const page of this._pages) {
      if (page.document.docHandle !== this.docHandle) continue; // imported pages carry their own annotations
      const annotations = await page.loadAnnotations();
      all.push(...(requestedSubtypes ? annotations.filter((a) => requestedSubtypes.has(a.subtype)) : annotations));
    }
    return all;
  }

  /**
   * Loads every highlight annotation in the document. Each result includes its
   * 1-based page number. With `includeText`, the engine also loads the relevant
   * pages' text and extracts the characters covered by the highlight quadpoints.
   */
  async loadHighlights(options: PdfLoadHighlightsOptions = {}): Promise<PdfHighlightObject[]> {
    const annotations = await this.loadAnnotations({ subtype: 'highlight' });
    const highlights: PdfHighlightObject[] = annotations.map((annotation) => ({
      ...annotation,
      subtype: 'highlight',
      text: null,
    }));
    if (!options.includeText || highlights.length === 0) return highlights;

    const textByPage = new Map<number, PdfPageRawText | null>();
    await Promise.all([...new Set(highlights.map((h) => h.pageNumber))].map(async (pageNumber) => {
      const page = this._pages[pageNumber - 1];
      textByPage.set(pageNumber, page ? await page.loadText() : null);
    }));
    return highlights.map((highlight) => ({
      ...highlight,
      text: extractHighlightText(highlight, textByPage.get(highlight.pageNumber) ?? null),
    }));
  }

  /**
   * Creates an annotation on `pageNumber` (1-based) from `spec` and returns its
   * id (the `/NM` key). The worker generates the annotation's appearance stream,
   * so it is included by {@link encodePdf} and renders in other PDF viewers.
   * Only ink / markup / square / circle / freeText / text geometries are honored
   * — see {@link PdfAnnotationSpec}. Fires `annotationsChanged` (`source: 'api'`).
   */
  async addAnnotation(pageNumber: number, spec: PdfAnnotationSpec): Promise<string> {
    if (this._isDisposed) throw new Error('Document is disposed');
    const page = this.pageForAnnotation(pageNumber);
    const result = await this.sendCommand('addAnnotation', {
      docHandle: this.docHandle,
      pageIndex: page.sourcePageIndex,
      spec: page.annotationSpecToWire(spec),
    });
    this.emit('annotationsChanged', { source: 'api', pageNumbers: [pageNumber] });
    return result.id;
  }

  /**
   * Replaces the annotation `id` on `pageNumber` with a fresh one built from
   * `spec`, keeping the same id. Geometry has no in-place setter, so an edit is a
   * remove + recreate; pass the full new spec (e.g. moved/resized geometry).
   * Fires `annotationsChanged` (`source: 'api'`).
   */
  async updateAnnotation(pageNumber: number, id: string, spec: PdfAnnotationSpec): Promise<string> {
    if (this._isDisposed) throw new Error('Document is disposed');
    const page = this.pageForAnnotation(pageNumber);
    const result = await this.sendCommand('updateAnnotation', {
      docHandle: this.docHandle,
      pageIndex: page.sourcePageIndex,
      id,
      spec: page.annotationSpecToWire(spec),
    });
    this.emit('annotationsChanged', { source: 'api', pageNumbers: [pageNumber] });
    return result.id;
  }

  /**
   * Removes the annotation `id` from `pageNumber`. Returns whether it was found.
   * Fires `annotationsChanged` (`source: 'api'`).
   */
  async removeAnnotation(pageNumber: number, id: string): Promise<boolean> {
    if (this._isDisposed) throw new Error('Document is disposed');
    const page = this.pageForAnnotation(pageNumber);
    const result = await this.sendCommand('removeAnnotation', {
      docHandle: this.docHandle,
      pageIndex: page.sourcePageIndex,
      id,
    });
    this.emit('annotationsChanged', { source: 'api', pageNumbers: [pageNumber] });
    return result.ok;
  }

  /**
   * Bulk-creates annotations (one {@link addAnnotation} per item) and returns
   * their ids in order. Convenience for importing an exported annotation set.
   */
  async importAnnotations(items: readonly { pageNumber: number; spec: PdfAnnotationSpec }[]): Promise<string[]> {
    const ids: string[] = [];
    for (const item of items) ids.push(await this.addAnnotation(item.pageNumber, item.spec));
    return ids;
  }

  /**
   * Resolves a 1-based page number to a host-document page usable for annotation
   * writes (imported pages are rejected, matching `loadAnnotations`).
   * @internal
   */
  private pageForAnnotation(pageNumber: number): PdfPage {
    const page = this._pages[pageNumber - 1];
    if (!page) throw new Error(`Invalid page number: ${pageNumber}`);
    if (page.document.docHandle !== this.docHandle) {
      throw new Error(`Cannot edit annotations on imported page ${pageNumber}`);
    }
    return page;
  }

  /**
   * Sends one form-field write to the worker (find the field's page, dispatch
   * the typed command). No calculation or event — the primitive shared by
   * {@link setFormFieldValue} and {@link runFormCalculations}.
   * @internal
   */
  private async sendSetFormFieldValue(name: string, value: PdfFormFieldValue): Promise<void> {
    let sourcePageIndex = this.formFieldSourceIndex.get(name);
    if (sourcePageIndex === undefined) {
      await this.loadFormFields(); // populate the cache
      sourcePageIndex = this.formFieldSourceIndex.get(name);
      if (sourcePageIndex === undefined) throw new Error(`Form field not found: ${name}`);
    }
    const params: {
      docHandle: number;
      formHandle: number;
      pageIndex: number;
      fieldName: string;
      value?: string;
      checked?: boolean;
      selectedLabels?: string[];
    } = { docHandle: this.docHandle, formHandle: this.formHandle, pageIndex: sourcePageIndex, fieldName: name };
    if (typeof value === 'boolean') params.checked = value;
    else if (Array.isArray(value)) params.selectedLabels = value;
    else params.value = value;
    await this.sendCommand('setFormFieldValue', params);
  }

  /**
   * Loads (once) and caches the document's parsed `AFSimple_Calculate` specs.
   * @internal
   */
  private async ensureCalcSpecs(): Promise<{ name: string; spec: FormCalcSpec }[]> {
    if (this.calcSpecs) return this.calcSpecs;
    if (!this.formHandle) return (this.calcSpecs = []);
    const result = await this.sendCommand('loadFormCalculations', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      pageCount: this.nativePageCount,
    });
    this.calcSpecs = result.calculations
      .map((c) => ({ name: c.name, spec: parseCalcAction(c.js) }))
      .filter((c): c is { name: string; spec: FormCalcSpec } => c.spec !== null);
    return this.calcSpecs;
  }

  /**
   * Recomputes calculated fields (`AFSimple_Calculate`) to a fixed point from the
   * current field values and writes back the ones that changed. A JS-free stand-in
   * for the calculate actions this PDFium build cannot run.
   * @internal
   */
  private async runFormCalculations(): Promise<void> {
    const specs = await this.ensureCalcSpecs();
    if (specs.length === 0) return;
    const fields = await this.loadFormFields();
    const values = new Map(fields.map((f) => [f.name, f.value] as const));
    const pdfValues = new Map(values);
    for (let iter = 0; iter < 16; iter++) {
      let changed = false;
      for (const { name, spec } of specs) {
        const result = evaluateCalc(spec, values);
        if (result !== null && result !== values.get(name)) {
          values.set(name, result);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const { name } of specs) {
      const v = values.get(name);
      if (v !== undefined && v !== pdfValues.get(name)) {
        await this.sendSetFormFieldValue(name, v);
      }
    }
  }

  /**
   * Reserved for internal use only (the viewer). Opens `page` for interactive
   * form editing so pointer/keyboard events can be routed to it. Idempotent.
   * @internal
   */
  async formOpenPage(page: PdfPage): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    await this.sendCommand('formOpenPage', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      pageIndex: page.sourcePageIndex,
    });
  }

  /**
   * Reserved for internal use only (the viewer). Closes an interactive form page.
   * @internal
   */
  async formClosePage(page: PdfPage): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    await this.sendCommand('formClosePage', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      pageIndex: page.sourcePageIndex,
    });
  }

  /**
   * Reserved for internal use only (the viewer). Forwards a pointer event; `x`/`y`
   * are in the page's bounding-box-relative PDF coordinates (same space as
   * {@link PdfFormField.rects}), y-up.
   * @internal
   */
  async formPointerEvent(
    page: PdfPage,
    type: 'down' | 'up' | 'move' | 'doubleClick',
    x: number,
    y: number,
    modifier = 0,
  ): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    const [rawX, rawY] = page.toRawPagePoint(x, y);
    await this.sendCommand('formPointerEvent', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      pageIndex: page.sourcePageIndex,
      type,
      x: rawX,
      y: rawY,
      modifier,
    });
  }

  /**
   * Reserved for internal use only (the viewer). Forwards a keyboard event.
   * @internal
   */
  async formKeyEvent(
    page: PdfPage,
    type: 'char' | 'keyDown' | 'keyUp',
    code: number,
    modifier = 0,
  ): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    await this.sendCommand('formKeyEvent', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      pageIndex: page.sourcePageIndex,
      type,
      code,
      modifier,
    });
  }

  /**
   * Reserved for internal use only (the viewer). Clears the form keyboard focus.
   * @internal
   */
  async formKillFocus(): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    await this.sendCommand('formKillFocus', { docHandle: this.docHandle, formHandle: this.formHandle });
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
      return new PdfPermissions(wire.permissions, wire.securityHandlerRevision);
    }
    return null;
  }
}

/**
 * Spec for constructing a *proxy* page: a stand-in that presents a different
 * page number and/or rotation for an existing page without touching the
 * underlying PDF. Built by {@link PdfPage.rotatedTo} and friends.
 * @internal
 */
export interface PdfPageProxySpec {
  readonly basePage: PdfPage;
  readonly pageNumber: number;
  readonly rotation: PdfPageRotation;
}

/**
 * A page of a document. Obtain instances via {@link PdfDocument.pages}; do not
 * construct directly.
 *
 * A page has two identities that usually coincide but need not: where it sits
 * in the document ({@link pageNumber}, {@link rotation}) and which physical page
 * of which PDF it draws ({@link sourcePage}). {@link rotatedTo} /
 * {@link withPageNumber} return *proxy* pages that change the former while
 * sharing the latter, which is what makes {@link PdfDocument.setPages}
 * rearrangement free — see {@link PdfDocument.setPages}.
 */
export class PdfPage {
  /** @internal */
  constructor(
    /** The document holding the physical page this one draws. */
    readonly document: PdfDocument,
    src: WirePageInfo | PdfPageProxySpec,
  ) {
    if ('basePage' in src) {
      // Proxies are never nested: wrapping a proxy re-wraps its base instead, so
      // `basePage` is always a real page and no unwrap-the-chain walk is needed.
      const base = src.basePage.sourcePage;
      this.basePage = base;
      this.pageNumber = src.pageNumber;
      this.rotation = src.rotation;
      this.sourcePageIndex = base.sourcePageIndex;
      this.sourceRotation = base.sourceRotation;
      this.isLoaded = base.isLoaded;
      this.bbLeft = base.bbLeft;
      this.bbBottom = base.bbBottom;
      // A quarter-turn away from the physical rotation swaps the page's extent.
      const swapWH = ((((src.rotation - base.sourceRotation) / 90) | 0) & 1) === 1;
      this.width = swapWH ? base.height : base.width;
      this.height = swapWH ? base.width : base.height;
    } else {
      this.basePage = null;
      this.pageNumber = src.pageIndex + 1;
      this.rotation = pdfPageRotationFromIndex(src.rotation);
      this.sourcePageIndex = src.pageIndex;
      this.sourceRotation = this.rotation;
      this.isLoaded = src.isLoaded;
      this.bbLeft = src.bbLeft;
      this.bbBottom = src.bbBottom;
      this.width = src.width;
      this.height = src.height;
    }
  }

  /** 1-based page number — the position in {@link PdfDocument.pages}, not in the PDF. */
  readonly pageNumber: number;
  /** Page width in points (1/72 inch), at {@link rotation}. */
  readonly width: number;
  /** Page height in points (1/72 inch), at {@link rotation}. */
  readonly height: number;
  /** Effective page rotation (clockwise); on a rotated proxy this differs from the rotation baked into the PDF. */
  readonly rotation: PdfPageRotation;
  /** False for pages not yet materialized during progressive loading. */
  readonly isLoaded: boolean;
  /** The real page this one stands in for, or `null` if this *is* a real page. */
  readonly basePage: PdfPage | null;
  /** Reserved for internal use only. 0-based index of the physical page within {@link document}'s PDF. @internal */
  readonly sourcePageIndex: number;
  /** Reserved for internal use only. Rotation baked into the PDF for the physical page. @internal */
  readonly sourceRotation: PdfPageRotation;
  /** Left of the page's bounding box; text/link rects are shifted by it internally. @internal */
  private readonly bbLeft: number;
  /** Bottom of the page's bounding box; text/link rects are shifted by it internally. @internal */
  private readonly bbBottom: number;

  /** Whether this page is a proxy over {@link basePage} rather than a real page. */
  get isProxy(): boolean {
    return this.basePage !== null;
  }

  /** The real page backing this one; `this` when {@link isProxy} is false. */
  get sourcePage(): PdfPage {
    return this.basePage ?? this;
  }

  /**
   * Whether `other` draws the same physical page of the same PDF, regardless of
   * page number or rotation. Useful for keying caches by content.
   */
  hasSameSource(other: PdfPage): boolean {
    return other.document.docHandle === this.document.docHandle && other.sourcePageIndex === this.sourcePageIndex;
  }

  /**
   * Identity of the physical page, independent of where it sits in the document.
   * Two pages with the same key produce the same text and links.
   */
  get sourceKey(): string {
    return `${this.document.docHandle}:${this.sourcePageIndex}`;
  }

  /**
   * Identity of what {@link render} draws — {@link sourceKey} plus rotation.
   * Cache bitmaps under this and moving a page around costs nothing.
   */
  get renderKey(): string {
    return `${this.sourceKey}:${this.rotation}`;
  }

  /**
   * Returns a page identical to this one but at `pageNumber`, or `this` if it is
   * already there. Nothing is rendered or reloaded — see {@link PdfDocument.setPages}.
   */
  withPageNumber(pageNumber: number): PdfPage {
    if (pageNumber === this.pageNumber) return this;
    return new PdfPage(this.document, { basePage: this, pageNumber, rotation: this.rotation });
  }

  /**
   * Returns a page identical to this one but rotated to the absolute `rotation`,
   * or `this` if it is already there. The PDF is untouched; only what the viewer
   * draws changes. Chainable with {@link withPageNumber}.
   */
  rotatedTo(rotation: PdfPageRotation): PdfPage {
    if (rotation === this.rotation) return this;
    return new PdfPage(this.document, { basePage: this, pageNumber: this.pageNumber, rotation });
  }

  /** Returns this page rotated by `delta` clockwise, relative to its current {@link rotation}. */
  rotatedBy(delta: PdfPageRotation): PdfPage {
    return this.rotatedTo(pdfPageRotationFromIndex((this.rotation + delta) / 90));
  }

  /** Returns this page rotated 90° clockwise. */
  rotatedCW90(): PdfPage {
    return this.rotatedBy(90);
  }

  /** Returns this page rotated 90° counter-clockwise. */
  rotatedCCW90(): PdfPage {
    return this.rotatedBy(270);
  }

  /** Returns this page rotated 180°. */
  rotated180(): PdfPage {
    return this.rotatedBy(180);
  }

  /**
   * Reserved for internal use only. Re-points this page at a freshly loaded
   * `base` (same physical page, new metadata) while keeping any proxy overrides.
   * @internal
   */
  rebasedOn(base: PdfPage): PdfPage {
    if (this.basePage === null) return base;
    return new PdfPage(base.document, { basePage: base, pageNumber: this.pageNumber, rotation: this.rotation });
  }

  /**
   * Reserved for internal use only. This page as a source slot for
   * {@link PdfDocument.assemblePages}.
   * @internal
   */
  toAssembleSource(): PdfAssembleSource {
    return {
      document: this.document,
      pageNumber: this.sourcePageIndex + 1,
      ...(this.rotation === this.sourceRotation ? {} : { rotation: this.rotation }),
    };
  }

  /**
   * Renders (a part of) the page to a {@link PdfImage} of RGBA8888 pixels
   * (Canvas/WebGL-ready; the worker converts from the engine's native BGRA).
   *
   * The page is scaled to `fullWidth` x `fullHeight` (defaulting to the page
   * size in points, i.e. 72 dpi) and the `x`/`y`/`width`/`height` sub-region of
   * that scaled page is returned. Use {@link PdfImage.toImageData} /
   * {@link PdfImage.toImageBitmap} to draw the result. Returns `null` if the
   * document is already disposed, or if
   * {@link PdfPageRenderOptions.cancellationToken} was cancelled.
   *
   * Renders are queued (one in the worker at a time by default) rather than all
   * posted at once, so a render that is no longer wanted can be dropped before
   * it starts — see {@link createCancellationToken}.
   */
  async render(options: PdfPageRenderOptions = {}): Promise<PdfImage | null> {
    if (this.document.isDisposed) return null;
    const fullWidth = options.fullWidth ?? this.width;
    const fullHeight = options.fullHeight ?? this.height;
    const width = options.width ?? Math.floor(fullWidth);
    const height = options.height ?? Math.floor(fullHeight);

    const result = await this.document.enqueueRender(
      () =>
        this.document.sendCommand('renderPage', {
          docHandle: this.document.docHandle,
          pageIndex: this.sourcePageIndex,
          x: options.x ?? 0,
          y: options.y ?? 0,
          width,
          height,
          fullWidth,
          fullHeight,
          backgroundColor: options.backgroundColor ?? 0xffffffff,
          // Relative to the rotation baked into the PDF, so a rotated proxy
          // renders turned without the document having been rewritten.
          rotation: (((options.rotationOverride ?? this.rotation) - this.sourceRotation) / 90 + 4) & 3,
          annotationRenderingMode: annotationRenderingModeToIndex(
            options.annotationRenderingMode ?? 'annotationAndForms',
          ),
          flags: options.flags ?? 0,
          formHandle: this.document.formHandle,
        }),
      options.cancellationToken,
    );
    if (!result) return null; // cancelled
    this.document.updateMissingFonts(result.missingFonts);
    return new PdfImage(width, height, new Uint8Array(result.imageData));
  }

  /**
   * Creates a token that cancels a {@link render} that has not started yet,
   * making it resolve to `null`. Use one per render call.
   *
   * @example
   * ```ts
   * const token = page.createCancellationToken();
   * scrolledAway.then(() => token.cancel());
   * const image = await page.render({ fullWidth, fullHeight, cancellationToken: token });
   * ```
   */
  createCancellationToken(): PdfPageRenderCancellationToken {
    return new PdfPageRenderCancellationToken();
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
      pageIndex: this.sourcePageIndex,
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
      pageIndex: this.sourcePageIndex,
      enableAutoLinkDetection: options.enableAutoLinkDetection ?? true,
    });
    return result.links.map((link) => ({
      rects: link.rects.map((r) => this.rectFromWire(r)),
      url: link.url ?? null,
      // Resolved against the document the page physically lives in. For a page
      // imported into another document, an internal link therefore names a
      // position in its *source* document — the PDF has no destination for the
      // host, so there is nothing better to report.
      dest: pdfDestFromWire(link.dest, this.document),
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
   * Loads the AcroForm fields whose widgets sit on this page, grouped by
   * fully-qualified name. Rects are in PDF page coordinates (bounding-box
   * relative, like {@link loadLinks}). Returns an empty array if the document is
   * disposed, has no form, or the page is not yet loaded.
   */
  async loadFormFields(): Promise<PdfFormField[]> {
    if (this.document.isDisposed || !this.isLoaded || !this.document.formHandle) return [];
    const result = await this.document.sendCommand('loadFormFields', {
      docHandle: this.document.docHandle,
      formHandle: this.document.formHandle,
      pageIndex: this.sourcePageIndex,
    });
    return groupWireFormFields(result.fields, this);
  }

  /**
   * Loads the content annotations on this page (ink, shapes, text markup, notes,
   * free text — not widgets/links/popups), with rects and geometry in
   * bounding-box-relative page coordinates (like {@link loadLinks}). Returns an
   * empty array if the document is disposed or the page is not yet loaded.
   */
  async loadAnnotations(): Promise<PdfAnnotationObject[]> {
    if (this.document.isDisposed || !this.isLoaded) return [];
    const result = await this.document.sendCommand('loadAnnotations', {
      docHandle: this.document.docHandle,
      pageIndex: this.sourcePageIndex,
    });
    return result.annotations.map((a) => this.annotationFromWire(a));
  }

  /** @internal Converts a wire annotation (raw coords) to the public model (bbox-relative). */
  private annotationFromWire(a: WireAnnotationObject): PdfAnnotationObject {
    return {
      id: a.id,
      pageNumber: this.pageNumber,
      subtype: pdfAnnotationSubtypeFromName(a.subtype),
      rect: this.rectFromWire(a.rect),
      color: colorFromWire(a.color),
      interiorColor: colorFromWire(a.interiorColor),
      borderWidth: a.borderWidth,
      flags: a.flags,
      contents: a.contents,
      author: a.author,
      fontFace: a.fontFace,
      appearanceLines: a.appearanceLines,
      appearanceRuns: a.appearanceRuns,
      appearancePaths: a.appearancePaths.map((path) => ({
        ...path,
        fillColor: colorFromWire(path.fillColor),
        strokeColor: colorFromWire(path.strokeColor),
        segments: path.segments.map(([type, x, y, close]) => ({
          // FPDF_PATHSEGMENT_* values: LINETO=0, BEZIERTO=1, MOVETO=2.
          type: type === 2 ? 'move' as const : type === 1 ? 'bezier' as const : 'line' as const,
          point: this.pointFromWire(x, y),
          close: !!close,
        })),
      })),
      appearanceTextStyles: a.appearanceTextStyles.map((style) => ({
        origin: this.pointFromWire(style.x, style.y),
        fontSize: style.fontSize,
        fillColor: colorFromWire(style.fillColor),
      })),
      subject: a.subject,
      modificationDate: a.modificationDate,
      creationDate: a.creationDate,
      geometry: this.annotationGeometryFromWire(a.geometry),
    };
  }

  /** @internal */
  private annotationGeometryFromWire(g: WireAnnotationGeometry): PdfAnnotationGeometry {
    switch (g.kind) {
      case 'ink':
        return { kind: 'ink', strokes: g.strokes.map((s) => this.pointsFromFlat(s)) };
      case 'markup':
        return { kind: 'markup', quads: g.quads.map((q) => this.quadFromWire(q)) };
      case 'line':
        return {
          kind: 'line',
          start: this.pointFromWire(g.line[0], g.line[1]),
          end: this.pointFromWire(g.line[2], g.line[3]),
        };
      case 'polygon':
        return { kind: 'polygon', vertices: this.pointsFromFlat(g.vertices) };
      case 'polyline':
        return { kind: 'polyline', vertices: this.pointsFromFlat(g.vertices) };
      default:
        return { kind: 'none' };
    }
  }

  /**
   * @internal Converts an annotation spec (bbox-relative page coords) to the wire
   * form (raw page coords) the worker's create/replace commands expect.
   */
  annotationSpecToWire(spec: PdfAnnotationSpec): WireAnnotationSpec {
    return {
      subtype: spec.subtype,
      rect: spec.rect ? this.rectToWire(spec.rect) : undefined,
      color: spec.color === undefined ? undefined : spec.color === null ? null : colorToWire(spec.color),
      interiorColor:
        spec.interiorColor === undefined ? undefined : spec.interiorColor === null ? null : colorToWire(spec.interiorColor),
      borderWidth: spec.borderWidth,
      flags: spec.flags,
      contents: spec.contents,
      author: spec.author,
      fontFace: spec.fontFace,
      appearanceLines: spec.appearanceLines,
      appearanceRuns: spec.appearanceRuns,
      geometry: spec.geometry ? this.annotationGeometryToWire(spec.geometry) : undefined,
    };
  }

  /** @internal */
  private annotationGeometryToWire(g: PdfAnnotationGeometry): WireAnnotationGeometry {
    switch (g.kind) {
      case 'ink':
        return { kind: 'ink', strokes: g.strokes.map((s) => this.flatFromPoints(s)) };
      case 'markup':
        return { kind: 'markup', quads: g.quads.map((q) => this.quadToWire(q)) };
      case 'line': {
        const [sx, sy] = this.toRawPagePoint(g.start.x, g.start.y);
        const [ex, ey] = this.toRawPagePoint(g.end.x, g.end.y);
        return { kind: 'line', line: [sx, sy, ex, ey] };
      }
      case 'polygon':
        return { kind: 'polygon', vertices: this.flatFromPoints(g.vertices) };
      case 'polyline':
        return { kind: 'polyline', vertices: this.flatFromPoints(g.vertices) };
      default:
        return { kind: 'none' };
    }
  }

  /** @internal */
  private pointFromWire(x: number, y: number): PdfAnnotationPoint {
    return { x: x - this.bbLeft, y: y - this.bbBottom };
  }

  /** @internal */
  private pointsFromFlat(flat: number[]): PdfAnnotationPoint[] {
    const pts: PdfAnnotationPoint[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push(this.pointFromWire(flat[i]!, flat[i + 1]!));
    return pts;
  }

  /** @internal */
  private quadFromWire(q: number[]): PdfAnnotationQuad {
    return {
      topLeft: this.pointFromWire(q[0]!, q[1]!),
      topRight: this.pointFromWire(q[2]!, q[3]!),
      bottomLeft: this.pointFromWire(q[4]!, q[5]!),
      bottomRight: this.pointFromWire(q[6]!, q[7]!),
    };
  }

  /** @internal */
  private flatFromPoints(pts: PdfAnnotationPoint[]): number[] {
    const flat: number[] = [];
    for (const p of pts) {
      const [x, y] = this.toRawPagePoint(p.x, p.y);
      flat.push(x, y);
    }
    return flat;
  }

  /** @internal */
  private quadToWire(q: PdfAnnotationQuad): number[] {
    return [
      ...this.toRawPagePoint(q.topLeft.x, q.topLeft.y),
      ...this.toRawPagePoint(q.topRight.x, q.topRight.y),
      ...this.toRawPagePoint(q.bottomLeft.x, q.bottomLeft.y),
      ...this.toRawPagePoint(q.bottomRight.x, q.bottomRight.y),
    ];
  }

  /** @internal Converts a bbox-relative {@link PdfRect} to a raw wire rect. */
  private rectToWire(r: PdfRect): WireRect {
    return [r.left + this.bbLeft, r.top + this.bbBottom, r.right + this.bbLeft, r.bottom + this.bbBottom];
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

  /**
   * Reserved for internal use only. Converts a wire rect to a bounding-box-relative
   * {@link PdfRect}; used by the form invalidate relay.
   * @internal
   */
  wireRectToPdf(r: WireRect): PdfRect {
    return this.rectFromWire(r);
  }

  /**
   * Reserved for internal use only. Converts a bounding-box-relative page point
   * (as used by {@link PdfFormField.rects} / {@link loadLinks}) back to raw PDF
   * page coordinates, which the form-fill `FORM_On*` input APIs expect.
   * @internal
   */
  toRawPagePoint(x: number, y: number): [number, number] {
    return [x + this.bbLeft, y + this.bbBottom];
  }
}

/** @internal */
function colorFromWire(c: WireColor | null): PdfAnnotationColor | null {
  return c ? { r: c[0], g: c[1], b: c[2], a: c[3] } : null;
}

/** @internal */
function colorToWire(c: PdfAnnotationColor): WireColor {
  return [c.r, c.g, c.b, c.a];
}

/**
 * Groups per-widget wire fields into public {@link PdfFormField}s keyed by
 * fully-qualified name (radio-group buttons and other same-named widgets merge),
 * converting rects to the page's bounding-box-relative coordinates.
 * @internal
 */
function groupWireFormFields(wireFields: WireFormField[], page: PdfPage): PdfFormField[] {
  const byName = new Map<string, WireFormField[]>();
  const order: string[] = [];
  wireFields.forEach((field, index) => {
    // Unnamed fields are never merged: give each its own bucket.
    const key = field.name ? `n:${field.name}` : `i:${index}`;
    let group = byName.get(key);
    if (!group) {
      group = [];
      byName.set(key, group);
      order.push(key);
    }
    group.push(field);
  });
  return order.map((key) => buildFormField(byName.get(key)!, page));
}

/**
 * Builds one {@link PdfFormField} from a group of same-named wire widgets.
 * @internal
 */
function buildFormField(group: WireFormField[], page: PdfPage): PdfFormField {
  const first = group[0]!;
  const type = pdfFormFieldTypeFromCode(first.fieldType);
  const rects = group.map((w) => page.wireRectToPdf(w.rect));
  const flags = decodeFormFieldFlags(first.flags);
  const base: PdfFormField = {
    name: first.name,
    type,
    pageNumber: page.pageNumber,
    rects,
    value: first.value,
    alternateName: first.alternateName || null,
    flags,
  };
  if (type === 'checkBox') {
    return { ...base, isChecked: !!first.isChecked, exportValue: first.exportValue || null };
  }
  if (type === 'radioButton') {
    const options = group.map((w) => ({
      label: w.exportValue ?? '',
      selected: (w.exportValue ?? '') === first.value && first.value !== '',
    }));
    const selected = options.find((o) => o.selected);
    return { ...base, isChecked: !!selected, exportValue: selected?.label ?? null, options };
  }
  if (type === 'comboBox' || type === 'listBox') {
    return { ...base, options: (first.options ?? []).map((o) => ({ label: o.label, selected: o.selected })) };
  }
  if (type === 'textField') {
    // /Ff bit 13 (value 1<<12) — Multiline.
    return { ...base, multiline: (first.flags & 0x1000) !== 0 };
  }
  return base;
}

/**
 * Converts a wire destination (0-based *physical* page index) to a public
 * {@link PdfDest}, whose `pageNumber` is a position in `doc.pages`. Returns
 * `null` if the destination is absent or its page is not in the arrangement
 * (e.g. it was removed by {@link PdfDocument.setPages}).
 */
function pdfDestFromWire(dest: WireDest | null | undefined, doc: PdfDocument): PdfDest | null {
  if (!dest) return null;
  const pageNumber = doc.pageNumberOfSourceIndex(dest.pageIndex);
  if (pageNumber === null) return null;
  return {
    pageNumber,
    command: dest.command,
    params: dest.params,
  };
}
