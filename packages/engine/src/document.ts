import { WorkerCommunicator, type WorkerCommunicatorOptions } from './communicator.js';
import { evaluateCalc, parseCalcAction, type FormCalcSpec } from './form-calc.js';
import {
  imageSourcesToWorkerPages,
  type PdfCreateFromImagesOptions,
  type PdfImageSource,
} from './image-source.js';
import { PdfPageRenderCancellationToken } from './render-queue.js';
import {
  prepareFreeTextAppearance,
  type PdfFreeTextAppearanceOptions,
} from './text-appearance.js';
import {
  isWorkerError,
  PdfErrorCode,
  type WorkerAnnotationGeometry,
  type WorkerAnnotationObject,
  type WorkerAnnotationSpec,
  type WorkerColor,
  type WorkerDest,
  type WorkerDocument,
  type WorkerFontQueries,
  type WorkerFormField,
  type PdfRawObject,
  type PdfRawPatchOperation,
  type PdfRawPatchValue,
  type PdfRawTarget,
  type WorkerFormNotification,
  type WorkerOutlineNode,
  type WorkerPageInfo,
  type WorkerRect,
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
  type PdfAnnotation,
  type PdfAnnotationGeometry,
  type PdfAnnotationObject,
  type PdfAnnotationChange,
  type PdfAnnotationHistoryChange,
  type PdfAnnotationMutationOptions,
  type PdfAnnotationSnapshot,
  type PdfAnnotationPoint,
  type PdfAnnotationQuad,
  type PdfAnnotationRenderingMode,
  type PdfAnnotationSpec,
  type PdfRestoreAnnotationsOptions,
  type PdfAnnotationSubtype,
  type PdfDest,
  type PdfDestOptions,
  type PdfDocumentEventMap,
  type PdfDocumentEventName,
  type PdfDownloadProgressCallback,
  type PdfFontQuery,
  type PdfFormField,
  type PdfFormFieldChange,
  type PdfFormFieldValue,
  type PdfFormMutationOptions,
  type PdfHighlightObject,
  type PdfLink,
  type PdfLinkTarget,
  type PdfLoadAnnotationsOptions,
  type PdfLoadHighlightsOptions,
  type PdfOutlineNode,
  type PdfPageRawText,
  type PdfPageArrangementEntry,
  type PdfPageMutationOptions,
  type PdfPageId,
  type PdfPageRotation,
  type PdfTextOrientation,
  type PdfPasswordProvider,
  PdfPermissions,
  type PdfRect,
  type PdfResolvedDest,
} from './types.js';

let nextPdfPageIdentity = 1;
const createPdfPageId = (): PdfPageId => `pdf-page-${nextPdfPageIdentity++}` as PdfPageId;
let nextPdfLinkIdentity = 1;
const createPdfLinkId = (): string => `pdfrx-link-${Date.now().toString(36)}-${nextPdfLinkIdentity++}`;

interface PdfLinkSpec {
  readonly rect: PdfRect;
  readonly target: PdfLinkTarget;
  readonly id?: string;
  readonly annotation?: PdfAnnotation | null;
}

function linkSpecFromAnnotationSpec(spec: PdfAnnotationSpec & { id: string; linkTarget: PdfLinkTarget }): PdfLinkSpec {
  if (!spec.rect) throw new Error('Link annotation requires rect');
  return {
    id: spec.id,
    rect: structuredClone(spec.rect),
    target: structuredClone(spec.linkTarget),
    annotation: {
      title: spec.author ?? null,
      content: spec.contents ?? null,
      subject: null,
      modificationDate: null,
      creationDate: null,
    },
  };
}

/** Converts the richer read model into the complete writable/persistable shape. */
export function annotationObjectToSpec(annotation: PdfAnnotationObject): PdfAnnotationSpec {
  const appearanceWidth = Math.max(0.01, annotation.rect.right - annotation.rect.left);
  const appearanceHeight = Math.max(0.01, annotation.rect.top - annotation.rect.bottom);
  return {
    id: annotation.id,
    subtype: annotation.subtype,
    linkTarget: annotation.linkTarget ? structuredClone(annotation.linkTarget) : undefined,
    rect: structuredClone(annotation.rect),
    color: annotation.color ? structuredClone(annotation.color) : null,
    interiorColor: annotation.interiorColor ? structuredClone(annotation.interiorColor) : null,
    borderWidth: annotation.borderWidth,
    flags: annotation.flags,
    contents: annotation.contents,
    author: annotation.author,
    actorId: annotation.actorId,
    revision: annotation.revision,
    textOrientation: structuredClone(annotation.textOrientation),
    textColor: annotation.textColor ? structuredClone(annotation.textColor) : null,
    fontSize: annotation.fontSize ?? undefined,
    textAlign: annotation.textAlign,
    textVerticalAlign: annotation.textVerticalAlign,
    fontFace: annotation.fontFace,
    appearanceLines: annotation.appearanceLines ? [...annotation.appearanceLines] : undefined,
    appearanceRuns: annotation.appearanceRuns?.map((line) => line.map((run) => structuredClone(run))),
    appearanceImage: annotation.appearanceImage ? structuredClone(annotation.appearanceImage) : undefined,
    appearancePaths: annotation.subtype === 'stamp' && !annotation.contents && !annotation.appearanceImage
      ? annotation.appearancePaths.map((path) => ({
          ...structuredClone(path),
          fillColor: path.fillMode ? structuredClone(path.fillColor) : null,
          strokeColor: path.stroke ? structuredClone(path.strokeColor) : null,
          strokeWidth: path.strokeWidth / appearanceWidth,
          segments: path.segments.map((segment) => ({
            ...segment,
            point: {
              x: (segment.point.x - annotation.rect.left) / appearanceWidth,
              y: (annotation.rect.top - segment.point.y) / appearanceHeight,
            },
          })),
        }))
      : undefined,
    geometry: structuredClone(annotation.geometry),
  };
}

/** Options for constructing a {@link PdfrxEngine}. */
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

/** Options for {@link PdfrxEngine.openData}; extends {@link PdfOpenOptions} with ownership control. */
export interface PdfOpenDataOptions extends PdfOpenOptions {
  /**
   * Transfer ownership of a full input buffer to the worker. Default: true.
   * Set to false to keep the caller's buffer usable; the engine transfers an
   * internal copy instead.
   *
   */
  transferData?: boolean;
}

/** Options for {@link PdfrxEngine.openUrl}; extends {@link PdfOpenOptions} with fetch-related settings. */
export interface PdfOpenUrlOptions extends PdfOpenOptions {
  /** Invoked as the document downloads (see {@link PdfDownloadProgressCallback}). */
  progressCallback?: PdfDownloadProgressCallback;
  /**
   * Access the file via HTTP range requests instead of downloading it whole.
   * Requires a CORS-enabled server that honors range requests.
   *
   */
  preferRangeAccess?: boolean;
  /** Extra HTTP headers for the fetch (e.g. authorization). */
  headers?: Record<string, string>;
  /** Whether the fetch includes credentials (cookies, HTTP auth). */
  withCredentials?: boolean;
}

/** How {@link PdfDocument.encodePdf} obtains the document it serializes. */
export type PdfEncodeMode = 'in-place' | 'copy' | 'compact';

/** Options for {@link PdfDocument.encodePdf}. */
export interface PdfEncodeOptions {
  /**
   * `in-place` materializes the arrangement into the live document; `copy`
   * clones a catalog-preserving base first; `compact` rebuilds the arranged
   * pages and their reachable page-level objects in a fresh document. Defaults
   * to `in-place`.
   *
   */
  readonly mode?: PdfEncodeMode;
  /** Requests incremental serialization. Not supported by `compact`. */
  readonly incremental?: boolean;
  /** Removes document security while serializing. */
  readonly removeSecurity?: boolean;
}

/** How {@link PdfDocument.createMaterializedCopy} treats the document catalog. */
export type PdfMaterializedCopyCatalog = 'preserve' | 'rebuild';

/** Options for {@link PdfDocument.createMaterializedCopy}. */
export interface PdfMaterializedCopyOptions {
  /**
   * `preserve` retains the selected base document's catalog; `rebuild` creates
   * a fresh catalog from the arranged pages and their reachable page-level
   * objects. Defaults to `preserve`.
   *
   */
  readonly catalog?: PdfMaterializedCopyCatalog;
}

/**
 * Builds a batch of raw PDF-object edits for {@link PdfDocument.editRawObjects}.
 *
 * Methods only record operations while the callback runs. No document mutation
 * occurs until the callback completes. The batch is then sent in one worker
 * command, either directly or through the temporary-copy transaction selected
 * by {@link PdfRawObjectEditOptions.atomic}.
 *
 * A target says *where* to edit; a patch value says *what* to store. Use
 * {@link catalog} or {@link object} for a starting target and {@link at} for a
 * nested dictionary/array container. {@link createDictionary} returns a
 * {@link PdfRawCreatedObject}: pass it directly as a later target, or pass its
 * {@link PdfRawCreatedObject.reference | reference} property as a value in
 * another object.
 *
 */
export interface PdfRawObjectEditor {
  /**
   * Returns a target for the document catalog (`/Root`) dictionary.
   *
   * @returns The resulting PdfRawTarget.
   *
   */
  catalog(): PdfRawTarget;
  /**
   * Returns a target for an existing indirect object.
   * @param objectNumber Positive PDF object number, as returned by
   *   {@link PdfDocument.getRawObject} or an indirect `reference` value.
   *
   * @returns The resulting PdfRawTarget.
   *
   */
  object(objectNumber: number): PdfRawTarget;
  /**
   * Returns a target for a nested container below `target`.
   *
   * String components select dictionary keys without the leading `/`; number
   * components select zero-based array items. Indirect references encountered
   * between components are dereferenced automatically.
   *
   * @example Target the first element of a nested array
   * ```ts
   * const firstKid = editor.at(editor.object(pagesObjectNumber), 'Kids', 0);
   * ```
   *
   * @param target - The target value.
   * @param path - The path value (string or number[]).
   * @returns The resulting PdfRawTarget.
   *
   */
  at(target: PdfRawTarget, ...path: (string | number)[]): PdfRawTarget;
  /**
   * Reserves a new indirect dictionary in this batch.
   *
   * The returned object is itself a target for further edits. Use its
   * {@link PdfRawCreatedObject.reference} property when storing an indirect
   * reference to it in another dictionary or array.
   *
   * @param entries - The entries value (Record).
   * @returns The resulting PdfRawCreatedObject.
   *
   */
  createDictionary(entries?: Record<string, PdfRawPatchValue>): PdfRawCreatedObject;
  /**
   * Sets or replaces one dictionary entry; `key` omits the leading `/`.
   *
   * @param target - The target value.
   * @param key - The cache key.
   * @param value - The value to use.
   *
   */
  setDictionaryValue(target: PdfRawTarget, key: string, value: PdfRawPatchValue): void;
  /**
   * Removes one dictionary entry; `key` omits the leading `/`.
   *
   * @param target - The target value.
   * @param key - The cache key.
   *
   */
  removeDictionaryValue(target: PdfRawTarget, key: string): void;
  /**
   * Appends a value to the target array.
   *
   * @param target - The target value.
   * @param value - The value to use.
   *
   */
  appendArrayValue(target: PdfRawTarget, value: PdfRawPatchValue): void;
  /**
   * Replaces the value at a zero-based array index.
   *
   * @param target - The target value.
   * @param index - The 0-based index.
   * @param value - The value to use.
   *
   */
  setArrayValue(target: PdfRawTarget, index: number, value: PdfRawPatchValue): void;
  /**
   * Removes the value at a zero-based array index.
   *
   * @param target - The target value.
   * @param index - The 0-based index.
   *
   */
  removeArrayValue(target: PdfRawTarget, index: number): void;
  /**
   * Replaces a stream's decoded bytes. PDFium updates the stream representation
   * when the document is encoded.
   *
   * @param target - The target value.
   * @param data - The input data.
   *
   */
  setStreamData(target: PdfRawTarget, data: Uint8Array): void;
}

/**
 * Handle for an indirect dictionary reserved by
 * {@link PdfRawObjectEditor.createDictionary}.
 *
 * Pass the handle itself to editor methods to mutate the new dictionary. Pass
 * {@link reference} as a patch value to store an indirect reference to it in a
 * catalog, dictionary, or array. The final numeric PDF object number is assigned
 * inside the worker and intentionally hidden from the callback.
 *
 */
export interface PdfRawCreatedObject extends PdfRawTarget {
  /** Batch-local identity used internally; it is not a PDF object number. */
  readonly localId: string;
  /** Patch value that stores an indirect reference to this newly-created dictionary. */
  readonly reference: PdfRawPatchValue;
}

/** Options controlling how {@link PdfDocument.editRawObjects} commits its batch. */
export interface PdfRawObjectEditOptions {
  /**
   * Whether to provide complete all-or-nothing behavior by applying the batch to
   * an independent PDF copy and adopting it only after every operation succeeds.
   *
   * Default: `false`. Without this option, an exception thrown while the edit
   * callback is building the batch is still safe—the worker is never called and
   * no operation runs. Once the completed batch reaches PDFium, however, a later
   * failing operation can leave earlier operations applied.
   *
   * Set this to `true` when failure must also roll back errors encountered while
   * PDFium applies the batch. This copies and reloads the complete document, so
   * its time and peak-memory cost grow with the PDF size.
   *
   */
  atomic?: boolean;
}

class RawPdfObjectEditor implements PdfRawObjectEditor {
  readonly operations: PdfRawPatchOperation[] = [];
  readonly createDictionaries: string[] = [];
  private nextLocalId = 1;

  catalog(): PdfRawTarget {
    return { root: true };
  }

  object(objectNumber: number): PdfRawTarget {
    if (!Number.isInteger(objectNumber) || objectNumber <= 0) {
      throw new RangeError('Raw PDF object numbers must be positive integers');
    }
    return { objectNumber };
  }

  at(target: PdfRawTarget, ...path: (string | number)[]): PdfRawTarget {
    return { ...target, path: [...(target.path ?? []), ...path] };
  }

  createDictionary(entries: Record<string, PdfRawPatchValue> = {}): PdfRawCreatedObject {
    const localId = `object${this.nextLocalId++}`;
    this.createDictionaries.push(localId);
    const target: PdfRawCreatedObject = {
      localId,
      reference: { kind: 'localReference', id: localId },
    };
    for (const [key, value] of Object.entries(entries)) this.setDictionaryValue(target, key, value);
    return target;
  }

  setDictionaryValue(target: PdfRawTarget, key: string, value: PdfRawPatchValue): void {
    this.operations.push({ op: 'dictionarySet', target: this.copyTarget(target), key, value });
  }

  removeDictionaryValue(target: PdfRawTarget, key: string): void {
    this.operations.push({ op: 'dictionaryRemove', target: this.copyTarget(target), key });
  }

  appendArrayValue(target: PdfRawTarget, value: PdfRawPatchValue): void {
    this.operations.push({ op: 'arrayAppend', target: this.copyTarget(target), value });
  }

  setArrayValue(target: PdfRawTarget, index: number, value: PdfRawPatchValue): void {
    this.operations.push({ op: 'arraySet', target: this.copyTarget(target), index, value });
  }

  removeArrayValue(target: PdfRawTarget, index: number): void {
    this.operations.push({ op: 'arrayRemove', target: this.copyTarget(target), index });
  }

  setStreamData(target: PdfRawTarget, data: Uint8Array): void {
    this.operations.push({ op: 'streamSetData', target: this.copyTarget(target), data });
  }

  private copyTarget(target: PdfRawTarget): PdfRawTarget {
    return { ...target, ...(target.path ? { path: [...target.path] } : {}) };
  }
}

/**
 * Options for {@link PdfPage.render}.
 *
 * The page is conceptually scaled to `fullWidth` x `fullHeight` pixels, and the
 * `x`/`y`/`width`/`height` sub-rectangle of that scaled page is what gets
 * rendered. All values are in pixels unless noted otherwise.
 *
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
   *
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
 * engine owns one worker shared by all documents it opens; call {@link dispose}
 * to tear it down.
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
 *
 */
export class PdfrxEngine {
  private communicator: WorkerCommunicator | null = null;
  private readonly options: PdfrxEngineOptions;

  /**
   * Creates an engine whose documents share one lazily initialized worker.
   *
   * @param options - Worker asset locations, factories, and host-specific configuration.
   */
  constructor(options: PdfrxEngineOptions = {}) {
    this.options = options;
  }

  /**
   * Spawns the worker and initializes the engine. Called implicitly by the open functions.
   *
   * @returns The resulting Promise.
   *
   */
  async init(): Promise<void> {
    if (!this.communicator) {
      this.communicator = new WorkerCommunicator(this.options);
    }
    await this.communicator.ready;
  }

  /**
   * The active communicator, or throws if {@link init} has not run.
   * @internal
   *
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
   * Ownership of a full `ArrayBuffer` (or a full `Uint8Array` view) is
   * transferred to the worker, detaching it from the caller. Partial views are
   * first copied into a tightly sized buffer and that copy is transferred.
   * Password retries reuse the worker-owned bytes and transfer only the new
   * password.
   *
   * @param data - The input data.
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async openData(data: Uint8Array | ArrayBuffer, options: PdfOpenDataOptions = {}): Promise<PdfDocument> {
    await this.init();
    const canTransferInput =
      data instanceof ArrayBuffer ||
      (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer);
    const sourceBuffer = data instanceof ArrayBuffer
      ? data
      : canTransferInput
        ? (data.buffer as ArrayBuffer)
        : data.slice().buffer;
    const buffer = options.transferData === false && canTransferInput ? sourceBuffer.slice(0) : sourceBuffer;
    const sourceName = options.sourceName ?? `data%${buffer.byteLength}`;
    const firstAttemptByEmptyPassword = options.firstAttemptByEmptyPassword ?? true;
    let dataHandle: number | undefined;
    try {
      for (let i = 0; ; i++) {
        let password: string | null = null;
        if (!(firstAttemptByEmptyPassword && i === 0)) {
          password = (await options.passwordProvider?.()) ?? null;
          if (password === null) {
            throw new PdfPasswordException(`No password supplied by passwordProvider (${sourceName})`);
          }
        }

        const result = dataHandle === undefined
          ? await this.comm.sendCommand(
              'loadDocumentFromData',
              {
                data: buffer,
                password,
                useProgressiveLoading: options.useProgressiveLoading ?? false,
              },
              [buffer],
            )
          : await this.comm.sendCommand('retryDocumentFromData', { dataHandle, password: password ?? '' });
        if (isWorkerError(result)) {
          if (result.errorCode === PdfErrorCode.password && result.dataHandle !== undefined) {
            dataHandle = result.dataHandle;
            continue;
          }
          throw new Error(`Failed to open document ${sourceName}: ${result.errorCodeStr} (${result.errorCode})`);
        }
        dataHandle = undefined;
        const doc = new PdfDocument(this.comm, result, sourceName, null);
        if (!(options.useProgressiveLoading ?? false)) doc.notifyLoadComplete();
        return doc;
      }
    } finally {
      if (dataHandle !== undefined) {
        await this.comm.sendCommand('cancelDocumentFromData', { dataHandle });
      }
    }
  }

  /**
   * Opens a document by URL. The worker fetches the bytes, so the URL must be
   * reachable under the page's CORS policy; relative URLs are resolved against
   * {@link WorkerCommunicatorOptions.baseUrl} (`document.baseURI` by default).
   * Set {@link PdfOpenUrlOptions.preferRangeAccess} to stream the file via range
   * requests.
   *
   * @param url - The URL to use.
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
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

  /**
   * Creates a new empty document.
   *
   * @param sourceName - The sourceName value (string).
   * @returns The resulting Promise.
   *
   */
  async createNew(sourceName = 'new'): Promise<PdfDocument> {
    await this.init();
    const result = await this.comm.sendCommand('createNewDocument', {});
    if (isWorkerError(result)) {
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
   *
   * @param images - The images value (PdfImageSource[]).
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async createFromImages(
    images: PdfImageSource[],
    options: PdfCreateFromImagesOptions = {},
  ): Promise<PdfDocument> {
    if (images.length === 0) throw new Error('createFromImages requires at least one image');
    await this.init();
    const { pages, transfer } = await imageSourcesToWorkerPages(images, options);
    const result = await this.comm.sendCommand('createDocumentFromImages', { pages }, transfer);
    if (isWorkerError(result)) {
      throw new Error(`Failed to create document from images: ${result.errorCodeStr} (${result.errorCode})`);
    }
    return new PdfDocument(this.comm, result, options.sourceName ?? 'images', null);
  }

  /**
   * Registers font data used to substitute missing fonts, then re-render affected pages.
   *
   * @param face - The face value (string).
   * @param data - The input data.
   * @param resolvedFace - The resolvedFace value (string).
   * @returns The resulting Promise.
   *
   */
  async addFontData(face: string, data: Uint8Array, resolvedFace?: string): Promise<void> {
    await this.init();
    const buffer = data.slice().buffer;
    await this.comm.sendCommand(
      'addFontData',
      { face, data: buffer, ...(resolvedFace !== undefined ? { resolvedFace } : {}) },
      [buffer],
    );
  }

  /**
   * Re-applies registered font data across the worker (e.g. after adding fonts).
   *
   * @returns The resulting Promise.
   *
   */
  async reloadFonts(): Promise<void> {
    await this.init();
    await this.comm.sendCommand('reloadFonts', { dummy: true });
  }

  /**
   * Discards all font data registered via {@link addFontData}.
   *
   * @returns The resulting Promise.
   *
   */
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
   *
   */
  private async openByFunc(
    open: (password: string | null) => Promise<WorkerDocument | import('./protocol.js').WorkerError>,
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
      if (isWorkerError(result)) {
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
 *
 */
type Listener<E extends PdfDocumentEventName> = (event: PdfDocumentEventMap[E]) => void;

/**
 * An open PDF document.
 *
 * Obtain instances from the opening methods of {@link PdfrxEngine}; do not
 * construct directly. Always {@link dispose} a document when finished to release
 * the underlying native handles.
 *
 */
/**
 * One page slot of an arrangement being written back to the PDF: which page to
 * place, from which document, at what rotation.
 * @internal
 *
 */
export interface PdfAssembleSource {
  /**
   * Source document to take the page from. Defaults to the document being
   * assembled; pass another {@link PdfDocument} to import one of its pages.
   *
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
    wire: WorkerDocument,
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
   *
   */
  private ensureFormNotify(): void {
    if (this.formNotifyCallbackId !== null || !this.formHandle || this._isDisposed) return;
    const callbackId = this.comm.registerCallback((notification: WorkerFormNotification) =>
      this.handleFormNotification(notification),
    );
    this.formNotifyCallbackId = callbackId;
    // Fire-and-forget: the worker stores the id against this document's form context.
    void this.comm.sendCommand('registerFormNotify', { docHandle: this.docHandle, callbackId }).catch(() => {});
  }

  /**
   * Dispatches a form notification relayed from the worker's form-fill callbacks.
   * @internal
   *
   */
  private handleFormNotification(notification: WorkerFormNotification): void {
    if (this._isDisposed) return;
    if (notification.kind === 'change') {
      if (this.formApiMutationDepth === 0) void this.captureInteractiveFormChange();
      return;
    }
    // invalidate: map the physical page index back onto the arrangement.
    const pageNumber = this.pageNumberOfSourceIndex(notification.pageIndex);
    if (pageNumber === null) return;
    const page = this._pages[pageNumber - 1];
    if (!page) return;
    const rect = page.WorkerRectToPdf(notification.rect);
    for (const listener of this.formInvalidateListeners) {
      try {
        listener(pageNumber, rect);
      } catch (e) {
        console.error('Error in form invalidate listener:', e);
      }
    }
  }

  private async captureInteractiveFormChange(): Promise<void> {
    const operation = this.formMutationLock.then(async () => {
      const before = new Map(this.lastFormValues);
      if (this.formCalculationEnabled) await this.runFormCalculations();
      const afterFields = await this.loadFormFields();
      const changes = this.diffFormValues(before, this.snapshotFormValues(afterFields));
      if (changes.length === 0) return;
      this.emit('formFieldsChanged', {
        source: 'user',
        origin: 'user',
        changes,
        pageNumbers: [...new Set(afterFields
          .filter((field) => changes.some((change) => change.name === field.name))
          .map((field) => field.pageNumber))],
      });
    });
    this.formMutationLock = operation.catch(() => {});
    await operation;
  }

  /**
   * Reserved for internal use only (the viewer). Subscribes to form dirty-region
   * redraws (page number + rect in PDF page coordinates). Returns an unsubscribe.
   * @internal
   *
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
   *
   */
  docHandle: number;
  /**
   * Reserved for internal use only. Native handle of the document's form
   * environment in the worker.
   * @internal
   *
   */
  formHandle: number;
  private formInfo: number;
  private readonly onDispose: (() => void) | null;
  private readonly listeners = new Map<PdfDocumentEventName, Set<Listener<PdfDocumentEventName>>>();
  private _pages: PdfPage[];
  /** Number of pages in the underlying PDF, which {@link setPages} can make differ from `_pages.length`. */
  private nativePageCount: number;
  private arrangementDirty = false;
  /** `undefined` means "read the physical PDF outline"; an array is a staged replacement. */
  private pendingOutline: readonly PdfOutlineNode[] | undefined;
  /** Staged Link-annotation replacements keyed by logical page identity. */
  private readonly pendingLinks = new Map<PdfPageId, readonly PdfLinkSpec[]>();
  /** Documents whose pages appear in this one's arrangement (see {@link setPages}). */
  private borrowedFrom = new Set<PdfDocument>();
  /** Documents whose arrangement includes pages of this one; warned about on {@link dispose}. */
  private readonly borrowers = new Set<PdfDocument>();
  private _isDisposed = false;
  private loadLock: Promise<void> = Promise.resolve();
  /** Serializes form transactions so their before/after snapshots cannot overlap. */
  private formMutationLock: Promise<void> = Promise.resolve();
  /** Callback id registered with the worker to relay form invalidate/change notifications. */
  private formNotifyCallbackId: number | null = null;
  /** Internal listeners (the viewer) wanting form dirty-region redraws. */
  private readonly formInvalidateListeners = new Set<(pageNumber: number, rect: PdfRect) => void>();
  /** Cache of field name → physical page index, populated by {@link loadFormFields}. */
  private readonly formFieldSourceIndex = new Map<string, number>();
  /** Latest observed values, used as the before-state for native interactive edits. */
  private lastFormValues = new Map<string, PdfFormFieldValue>();
  /** Suppresses worker notifications caused by a programmatic form transaction. */
  private formApiMutationDepth = 0;
  /** Lazily-loaded parsed `AFSimple_Calculate` specs (`null` until first needed). */
  private calcSpecs: { name: string; spec: FormCalcSpec }[] | null = null;
  /**
   * Whether {@link setFormFieldValue} recomputes dependent calculated fields
   * (`AFSimple_Calculate`) after a change. Default `true`.
   *
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

  /** Whether page, outline, or link edits are waiting to be {@link materialize | materialized}. */
  get hasPendingChanges(): boolean {
    return this.arrangementDirty || this.pendingOutline !== undefined || this.pendingLinks.size > 0;
  }

  /**
   * Turns the Unicode `contents` of a FreeText spec into a stable PDF
   * appearance. Call this after constructing the spec and before passing that
   * same object to {@link PdfPage.addAnnotation} or
   * {@link PdfPage.updateAnnotation}.
   *
   * This step is necessary because a PDF cannot simply inherit browser text
   * rendering. Han characters can require different glyphs for Japanese,
   * Simplified Chinese, Traditional Chinese, and Korean, while modern color
   * emoji must be rasterized and embedded as image runs. The method also
   * measures the resolved fonts and wraps the text to the annotation rectangle.
   *
   * The supplied spec is mutated in place: `fontFace`, `appearanceLines`, and
   * `appearanceRuns` are replaced.
   *
   * `language` is optional. Kana and Hangul identify Japanese and Korean
   * without a hint, and a browser automatically contributes
   * `navigator.languages` / `navigator.language`. Pass an explicit BCP-47
   * value when Han-only text is ambiguous, when the document language should
   * override the browser locale, or when running on a server. Server
   * integrations commonly use document metadata, the signed-in user's
   * locale, or a parsed `Accept-Language` preference.
   *
   * @example
   * ```ts
   * const spec: PdfAnnotationSpec = {
   *   subtype: 'freeText',
   *   rect: { left: 40, bottom: 700, right: 260, top: 750 },
   *   // Han-only text is ambiguous without a language or browser locale.
   *   contents: '契約内容 😀',
   *   fontSize: 14,
   * };
   *
   * await document.prepareFreeTextAppearance(spec, { language: 'ja' });
   * await document.pages[0]!.addAnnotation(spec);
   * ```
   *
   * In a browser whose locale represents the intended reader, the explicit
   * option can be omitted:
   *
   * @example Use the browser language automatically
   * ```ts
   * await document.prepareFreeTextAppearance(spec);
   * ```
   *
   * The default services work in browsers and server runtimes: browser-native
   * emoji is preferred, with a lazily downloaded, version-pinned Noto Emoji PNG
   * fallback. `@pdfrx/viewer` also supplies its browser font resolver and exact
   * Canvas measurement. Direct engine integrations can pass `services` for
   * private or offline fonts/assets, persistent server caches, or a different
   * text/emoji renderer.
   *
   * If `subtype` is not `freeText`, or `rect`/`contents` is absent, the method
   * returns without changing the spec.
   *
   * For runtime behavior and complete customization examples, read the
   * [Text, language, and emoji appearance guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/TEXT-APPEARANCE.md).
   *
   * @param spec - The spec value (PdfAnnotationSpec).
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async prepareFreeTextAppearance(
    spec: PdfAnnotationSpec,
    options: PdfFreeTextAppearanceOptions = {},
  ): Promise<void> {
    await prepareFreeTextAppearance(spec, options);
  }

  /**
   * Replaces the page arrangement — the one way to reorder, rotate, remove,
   * duplicate, and import pages, and the cheap, synchronous counterpart to
   * {@link materialize}.
   *
   * Nothing is sent to the worker and the PDF is not rebuilt: the pages are
   * proxies (including those returned by {@link PdfPage.rotatedTo}) over pages
   * that stay loaded, so reordering and rotating are immediate and free, and
   * undo is just setting the previous array back. Page numbers are assigned
   * automatically from the array order. This is what GUI page editing wants;
   * call {@link encodePdf} (or {@link materialize}) when pending edits
   * finally have to become a real PDF.
   *
   * Pages may come from other documents — those must stay open for as long as
   * they are referenced. Page numbers are reassigned to match the new order, so
   * callers can pass pages in any arrangement.
   *
   * Reusing the same {@link PdfPage} in more than one slot also reuses its
   * logical identity, making ID-based destinations unable to distinguish those
   * placements. Use {@link PdfPage.duplicate} when each occurrence must have
   * its own destination identity; see that method for examples and details.
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
   *
   * @param pages - The pages to process, in document order.
   * @param options - Options that customize the operation.
   *
   */
  setPages(pages: readonly PdfPage[], options: PdfPageMutationOptions = {}): void {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    if (pages.length === 0) throw new Error('setPages requires at least one page');
    const before = this.describePageArrangement(this._pages);
    const arranged = pages.map((page, index) => {
      if (page.sourceDocument.isDisposed) {
        throw new Error(`Page ${index + 1} belongs to disposed document ${page.sourceDocument.sourceName}`);
      }
      return page.placedIn(this, index + 1);
    });
    this.trackBorrowedDocuments(arranged);
    this._pages = arranged;
    this.arrangementDirty = true;
    const pageNumbers = arranged.map((p) => p.pageNumber);
    this.emit('pageStatusChanged', { pageNumbers });
    this.emit('pagesRearranged', {
      origin: options.origin ?? 'api',
      transactionId: options.transactionId,
      actorId: options.actorId,
      before,
      after: this.describePageArrangement(arranged),
      pageNumbers,
    });
  }

  /**
   * Replaces a single slot (1-based), keeping every other page in place — the
   * common case for GUI editing (`doc.setPage(3, doc.pages[2]!.rotatedCW90())`).
   * Like {@link setPages}, this touches no PDF data.
   *
   * Setting a page that is already present elsewhere reuses its logical
   * identity, so ID-based destinations cannot distinguish the two placements.
   * Use {@link PdfPage.duplicate}; see that method for examples and details.
   *
   * @param pageNumber - The 1-based page number.
   * @param page - The page to process.
   * @param options - Options that customize the operation.
   *
   */
  setPage(pageNumber: number, page: PdfPage, options: PdfPageMutationOptions = {}): void {
    if (pageNumber < 1 || pageNumber > this._pages.length) {
      throw new RangeError(`pageNumber ${pageNumber} out of range (1..${this._pages.length})`);
    }
    const pages = this._pages.slice();
    pages[pageNumber - 1] = page;
    this.setPages(pages, options);
  }

  private describePageArrangement(pages: readonly PdfPage[]): PdfPageArrangementEntry[] {
    return pages.map((page) => ({
      sourceKey: page.sourceKey,
      sourcePageIndex: page.sourcePageIndex,
      rotation: page.rotation,
    }));
  }

  /**
   * Updates the two-way record of which other documents this arrangement borrows
   * pages from, so that disposing one of them can be reported instead of quietly
   * turning those pages blank.
   * @internal
   *
   */
  private trackBorrowedDocuments(arranged: readonly PdfPage[]): void {
    const lenders = new Set<PdfDocument>();
    for (const page of arranged) {
      if (page.sourceDocument.docHandle !== this.docHandle) lenders.add(page.sourceDocument);
    }
    for (const previous of this.borrowedFrom) {
      if (!lenders.has(previous)) previous.borrowers.delete(this);
    }
    for (const lender of lenders) lender.borrowers.add(this);
    this.borrowedFrom = lenders;
  }

  /**
   * Maps a zero-based physical page index in this document's native PDF to its
   * current 1-based position in {@link pages}, or returns `null` when that
   * physical page is not present.
   *
   * "Source" here means the page owned by this document before the lightweight
   * arrangement in {@link pages} is applied. It is the same distinction exposed
   * by {@link PdfPage.sourceDocument} and the internal
   * `PdfPage.sourcePageIndex`: PDFium reports outlines, links, and form
   * notifications against the native PDF page tree, while {@link setPages}
   * creates a separate in-memory order of placement proxies.
   *
   * This is how destinations from the PDF itself — outline entries and internal
   * links, which PDFium reports as physical page indices — are translated into
   * page numbers callers can navigate to after {@link setPages}.
   *
   * Two caveats are inherent rather than fixable: a page placed twice can only
   * resolve to one position (the first wins), and a page removed from the
   * arrangement has no position at all, so destinations into it become `null`.
   *
   * @param physicalPageIndex - The 0-based physical page index.
   * @returns The resulting number or `null`.
   *
   */
  pageNumberOfSourceIndex(physicalPageIndex: number): number | null {
    if (!this.arrangementDirty) {
      // pages[i] is the physical page i, so the mapping is the identity.
      return physicalPageIndex >= 0 && physicalPageIndex < this._pages.length ? physicalPageIndex + 1 : null;
    }
    for (let i = 0; i < this._pages.length; i++) {
      const page = this._pages[i]!;
      if (page.sourceDocument.docHandle === this.docHandle && page.sourcePageIndex === physicalPageIndex) return i + 1;
    }
    return null;
  }

  /**
   * Resolves a destination against the current arrangement. When an ID occurs
   * more than once, one matching placement is selected; callers that need to
   * distinguish repeated pages should use {@link PdfPage.duplicate}.
   *
   * @param dest - The dest value (PdfDest).
   * @returns The resolved PdfResolvedDest or `null`.
   *
   */
  resolveDest(dest: PdfDest): PdfResolvedDest | null {
    const pageNumber = dest.by === 'pageNumber'
      ? dest.pageNumber
      : (this._pages.find((page) => page.id === dest.pageId)?.pageNumber ?? null);
    if (pageNumber === null || !this._pages[pageNumber - 1]) return null;
    return { pageNumber, command: dest.command, params: [...dest.params] };
  }

  /**
   * Subscribes to a document event (see {@link PdfDocumentEventMap}) and returns
   * an unsubscribe function.
   *
   * For `missingFonts`, queries already discovered while the document was
   * opening are replayed to the new listener on a microtask, so late
   * subscribers do not miss them.
   *
   * @param event - The event name to subscribe to.
   * @param listener - The callback to invoke when the value changes.
   * @returns A function that removes the listener.
   *
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
   *
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
  notifyLinksChanged(pageNumbers: number[]): void {
    this.emit('linksChanged', { pageNumbers });
  }

  /** @internal */
  pendingLinksFor(pageId: PdfPageId): readonly PdfLinkSpec[] | undefined {
    return this.pendingLinks.get(pageId);
  }

  /** @internal */
  stageLinks(pageId: PdfPageId, links: readonly PdfLinkSpec[], pageNumber: number): void {
    this.pendingLinks.set(pageId, cloneLinkSpecs(links));
    this.notifyLinksChanged([pageNumber]);
  }

  /**
   * Reserved for internal use only. Fires `loadComplete`; listen for the event
   * with {@link addEventListener} instead.
   * @internal
   *
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
   *
   */
  updateMissingFonts(missingFonts: WorkerFontQueries | undefined): void {
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
   *
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
   *
   */
  enqueueRender<T>(send: () => Promise<T>, token?: PdfPageRenderCancellationToken): Promise<T | null> {
    if (this._isDisposed) return Promise.resolve(null);
    return this.comm.enqueueRender(send, token);
  }

  /**
   * Closes the document and releases its native handles (and the form
   * environment). Idempotent; after disposal all page operations resolve to
   * `null`/empty or reject. Runs the `onDispose` hook supplied at open time.
   *
   * @returns The resulting Promise.
   *
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    if (this.borrowers.size > 0) {
      const names = [...this.borrowers].map((d) => d.sourceName).join(', ');
      console.warn(
        `pdfrx: disposing ${this.sourceName} while its pages are still placed in ${names} by setPages; ` +
          `those pages will no longer render. Call encodePdf()/materialize() on the borrowing ` +
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
   *
   * @param other - The other value (unknown).
   * @returns Whether the condition is satisfied.
   *
   */
  isIdenticalDocumentHandle(other: unknown): boolean {
    return other instanceof PdfDocument && other.docHandle === this.docHandle;
  }

  /**
   * Loads the logical document outline as a tree of {@link PdfOutlineNode}.
   * Returns the staged replacement when present; otherwise reads the physical
   * PDF outline from the worker.
   *
   * @returns The resolved Promise.
   *
   */
  async loadOutline(): Promise<PdfOutlineNode[]> {
    if (this.pendingOutline !== undefined) return cloneOutline(this.pendingOutline);
    const result = await this.sendCommand('loadOutline', { docHandle: this.docHandle });
    return result.outline.map((node) => this.outlineNodeFromWorker(node));
  }

  /**
   * Stages an immutable replacement for the document outline. No worker or PDF
   * object mutation occurs until {@link materialize} or in-place
   * {@link encodePdf}. {@link createMaterializedCopy} applies the staged
   * outline only to the returned document and leaves this document pending.
   *
   * @param outline - The outline value.
   *
   */
  setOutline(outline: readonly PdfOutlineNode[]): void {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    validateOutlineTree(outline);
    this.pendingOutline = cloneOutline(outline);
    this.emit('outlineChanged', {});
  }

  /** Writes one already-validated outline replacement into the physical PDF. */
  private async writeOutlineNow(outline: readonly PdfOutlineNode[]): Promise<void> {
    const pageReferences = await loadRawPageReferences(this);
    const flat: {
      node: PdfOutlineNode;
      parent: number | null;
      previous: number | null;
      next: number | null;
      children: number[];
    }[] = [];
    const visit = (siblings: readonly PdfOutlineNode[], parent: number | null): number[] => {
      const indices = siblings.map((node) => {
        const index = flat.length;
        flat.push({ node, parent, previous: null, next: null, children: [] });
        return index;
      });
      for (let i = 0; i < siblings.length; i++) {
        const node = siblings[i]!;
        const index = indices[i]!;
        flat[index]!.previous = indices[i - 1] ?? null;
        flat[index]!.next = indices[i + 1] ?? null;
        flat[index]!.children = visit(node.children, index);
      }
      return indices;
    };
    const top = visit(outline, null);

    await this.editRawObjects((editor) => {
      const catalog = editor.catalog();
      if (flat.length === 0) {
        editor.removeDictionaryValue(catalog, 'Outlines');
        return;
      }
      const root = editor.createDictionary();
      const items = flat.map(() => editor.createDictionary());
      editor.setDictionaryValue(catalog, 'Outlines', root.reference);
      editor.setDictionaryValue(catalog, 'PageMode', rawName('UseOutlines'));
      editor.setDictionaryValue(root, 'Type', rawName('Outlines'));
      editor.setDictionaryValue(root, 'First', items[top[0]!]!.reference);
      editor.setDictionaryValue(root, 'Last', items[top.at(-1)!]!.reference);
      editor.setDictionaryValue(root, 'Count', rawInteger(flat.length));
      for (let index = 0; index < flat.length; index++) {
        const entry = flat[index]!;
        const target = items[index]!;
        editor.setDictionaryValue(target, 'Title', rawText(entry.node.title));
        editor.setDictionaryValue(target, 'Parent', entry.parent === null ? root.reference : items[entry.parent]!.reference);
        if (entry.previous !== null) editor.setDictionaryValue(target, 'Prev', items[entry.previous]!.reference);
        if (entry.next !== null) editor.setDictionaryValue(target, 'Next', items[entry.next]!.reference);
        if (entry.children.length > 0) {
          editor.setDictionaryValue(target, 'First', items[entry.children[0]!]!.reference);
          editor.setDictionaryValue(target, 'Last', items[entry.children.at(-1)!]!.reference);
          editor.setDictionaryValue(target, 'Count', rawInteger(outlineDescendantCount(index, flat)));
        }
        if (entry.node.dest) {
          const resolved = this.resolveDest(entry.node.dest);
          if (!resolved) throw new Error(`Outline destination for "${entry.node.title}" does not resolve`);
          const pageReference = pageReferences[resolved.pageNumber - 1];
          if (pageReference === undefined) throw new Error(`Outline destination page ${resolved.pageNumber} is missing`);
          editor.setDictionaryValue(target, 'Dest', {
            kind: 'array',
            items: [
              rawReference(pageReference),
              rawName(pdfDestinationName(resolved.command)),
              ...resolved.params.map((value) => value === null ? { kind: 'null' as const } : rawNumber(value)),
            ],
          });
        }
      }
    }, { atomic: true });
  }

  /**
   * Recursively converts a wire outline node to the public {@link PdfOutlineNode},
   * mapping physical page indices onto the current arrangement.
   * @internal
   *
   */
  private outlineNodeFromWorker(node: WorkerOutlineNode): PdfOutlineNode {
    return {
      title: node.title,
      dest: pdfDestFromWorker(node.dest, this),
      children: node.children.map((child) => this.outlineNodeFromWorker(child)),
    };
  }

  /**
   * Loads remaining pages in chunks of roughly `loadUnitDurationMs` worth of work.
   * `onPageLoadProgress` can return `false` to stop loading further pages.
   *
   * @param onPageLoadProgress - The callback invoked when the corresponding event occurs.
   * @param loadUnitDurationMs - The loadUnitDurationMs value (number).
   * @returns The resolved Promise.
   *
   */
  async loadPagesProgressively(
    onPageLoadProgress?: (loadedPageCount: number, totalPageCount: number) => boolean | Promise<boolean>,
    loadUnitDurationMs = 250,
  ): Promise<void> {
    if (this._isDisposed) return;
    await this.synchronized(async () => {
      // Indices here are physical, not positional: after setPages the two differ.
      const unloaded = this._pages.filter((p) => !p.isLoaded && p.sourceDocument.docHandle === this.docHandle);
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

  /**
   * Reloads page metadata (e.g. after document modification).
   *
   * @param pageNumbersToReload - The pageNumbersToReload value (number[]).
   * @returns The resulting Promise.
   *
   */
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
   *
   */
  private replacePages(updated: PdfPage[]): void {
    if (updated.length === 0) return;
    const bySourceIndex = new Map(updated.map((p) => [p.sourcePageIndex, p]));
    const pages = this._pages.slice();
    const pageNumbers: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const current = pages[i]!;
      // Imported pages are reloaded by the document that owns them.
      if (current.sourceDocument.docHandle !== this.docHandle) continue;
      const fresh = bySourceIndex.get(current.sourcePageIndex);
      if (!fresh) continue;
      pages[i] = current.rebasedOn(fresh).placedIn(this, i + 1);
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
   *
   */
  private async refreshAllPages(before: readonly PdfPageArrangementEntry[]): Promise<void> {
    const identities = this._pages.map((page) => page.id);
    const result = await this.sendCommand('reloadPages', {
      docHandle: this.docHandle,
      currentPagesCount: this.nativePageCount,
    });
    const pages = result.pages
      .slice()
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .map((p, index) => new PdfPage(this, p, identities[index]));
    this._pages = pages;
    this.nativePageCount = pages.length;
    // The PDF now *is* the arrangement: no proxies are outstanding, and any
    // imported pages have been copied in, so nothing is borrowed any more.
    this.arrangementDirty = false;
    this.trackBorrowedDocuments(pages);
    this.updateMissingFonts(result.missingFonts);
    const pageNumbers = pages.map((p) => p.pageNumber);
    this.emit('pageStatusChanged', { pageNumbers });
    this.emit('pagesRearranged', {
      origin: 'materialize',
      before,
      after: this.describePageArrangement(pages),
      pageNumbers,
    });
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
   *
   */
  private async materializePageArrangement(): Promise<void> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    if (!this.arrangementDirty) return;
    const before = this.describePageArrangement(this._pages);
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
      await this.refreshAllPages(before);
    });
  }

  /**
   * Writes every pending page, outline, and Link-annotation edit into the
   * physical PDF. In-place {@link encodePdf} calls this automatically.
   * {@link createMaterializedCopy} instead materializes only its returned
   * independent document.
   *
   * @returns The resulting Promise.
   *
   */
  async materialize(): Promise<void> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    if (!this.hasPendingChanges) return;
    const wasModified = this.arrangementDirty;
    await this.materializePageArrangement();

    // PDFium's in-place page shuffle can leave raw page-tree references in
    // their pre-shuffle order. Re-cloning the now-materialized arrangement
    // normalizes that tree before document-level structures refer to pages.
    if (wasModified && (this.pendingOutline !== undefined || this.pendingLinks.size > 0)) {
      const normalized = await this.createArrangementCopy(this._pages);
      await this.adoptTransactionalCopy(normalized);
    }

    const outline = this.pendingOutline;
    if (outline !== undefined) {
      await this.writeOutlineNow(outline);
      if (this.pendingOutline === outline) this.pendingOutline = undefined;
    }

    for (const [pageId, links] of [...this.pendingLinks]) {
      const page = this._pages.find((candidate) => candidate.id === pageId);
      if (!page) throw new Error(`Link page ${pageId} is no longer present in the document`);
      await page.writeLinksNow(links);
      if (this.pendingLinks.get(pageId) === links) this.pendingLinks.delete(pageId);
    }
  }

  /**
   * Serializes the current logical state to PDF bytes, including pending page,
   * outline, and Link-annotation edits. In-place encoding writes them into this
   * document with {@link materialize} first; copy and compact encoding
   * materialize only a temporary document.
   *
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async encodePdf(options: PdfEncodeOptions = {}): Promise<Uint8Array> {
    const mode = options.mode ?? 'in-place';
    if (mode !== 'in-place') {
      if (mode === 'compact' && options.incremental) {
        throw new Error('incremental encoding is not supported in compact mode');
      }
      const copy = await this.createMaterializedCopy({
        catalog: mode === 'copy' ? 'preserve' : 'rebuild',
      });
      try {
        return await copy.encodePdf({
          mode: 'in-place',
          incremental: mode === 'compact' ? false : options.incremental,
          removeSecurity: options.removeSecurity,
        });
      } finally {
        await copy.dispose();
      }
    }
    await this.materialize();
    const result = await this.sendCommand('encodePdf', {
      docHandle: this.docHandle,
      incremental: options.incremental ?? false,
      removeSecurity: options.removeSecurity ?? false,
    });
    return new Uint8Array(result.data);
  }

  /**
   * Reads the document catalog as a structured value.
   * Indirect references remain references, so cyclic PDF graphs are never expanded.
   * Stream data is decoded; set `includeRawStreamData` to also receive its encoded bytes.
   *
   * This reads the physical PDF object graph in the worker, not pending logical
   * state created by {@link setPages}, {@link setPage}, {@link setOutline}, or
   * Link-annotation CRUD. When {@link hasPendingChanges} is `true`, call
   * {@link materialize} first (or use in-place {@link encodePdf}) before
   * interpreting affected page-tree dictionaries, page references, outlines,
   * annotations, or other catalog data.
   *
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async getCatalogObject(
    options: { includeRawStreamData?: boolean } = {},
  ): Promise<{ object: PdfRawObject | null; objectNumber: number; generationNumber: number }> {
    return this.sendCommand('rawGetObject', {
      docHandle: this.docHandle,
      ...(options.includeRawStreamData ? { includeRawStreamData: true } : {}),
    });
  }

  /**
   * Reads one indirect PDF object as a structured value.
   * Indirect references remain references, so cyclic PDF graphs are never expanded.
   * Stream data is decoded; set `includeRawStreamData` to also receive its encoded bytes.
   *
   * Object numbers and references belong to the physical PDF object graph in
   * the worker. Pending edits from {@link setPages}, {@link setPage},
   * {@link setOutline}, or Link-annotation edits exist only in logical state
   * and can disagree with that graph. Call {@link materialize} first (or use
   * in-place {@link encodePdf}) before reading affected objects or retaining
   * object numbers for later edits.
   *
   * @param objectNumber - The object number.
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async getRawObject(
    objectNumber: number,
    options: { includeRawStreamData?: boolean } = {},
  ): Promise<{ object: PdfRawObject | null; objectNumber: number; generationNumber: number }> {
    return this.sendCommand('rawGetObject', {
      docHandle: this.docHandle,
      objectNumber,
      ...(options.includeRawStreamData ? { includeRawStreamData: true } : {}),
    });
  }

  /** Sends an editor's compiled operation batch to the worker. */
  private async applyRawPatchInternal(
    operations: PdfRawPatchOperation[],
    options: { createDictionaries?: string[] } = {},
  ): Promise<Record<string, number>> {
    const result = await this.sendCommand('rawApplyPatch', {
      docHandle: this.docHandle,
      ...(options.createDictionaries ? { createDictionaries: options.createDictionaries } : {}),
      operations,
    });
    return result.created;
  }

  /**
   * Builds and applies a batch of convenient raw PDF-object edits.
   *
   * Raw targets and object numbers address the physical PDF object graph, not
   * pending edits created by {@link setPages}, {@link setPage},
   * {@link setOutline}, or Link-annotation CRUD. Raw editing does not
   * materialize those edits automatically. Call {@link materialize} explicitly
   * before inspecting raw objects and constructing a related edit batch;
   * otherwise the batch can target the old page tree, outline, annotations, or
   * object numbers. Calling {@link encodePdf} first is also sufficient because
   * it calls {@link materialize}.
   *
   * The callback only records operations. If it throws or rejects, the worker is
   * never called and the document is unchanged. By default, the completed batch
   * is then applied directly in one worker command. This avoids copying the PDF,
   * but it is not a rollback boundary: if PDFium applies some operations and a
   * later operation fails, the earlier changes can remain.
   *
   * Pass `{ atomic: true }` for complete all-or-nothing behavior. That mode
   * applies the batch to an independent materialized copy and makes this
   * `PdfDocument` adopt the copy only after every operation succeeds. It keeps
   * the original native document on failure, at the cost of copying and
   * reloading the entire PDF (with time and peak-memory costs proportional to
   * document size).
   *
   * Atomic success replaces the native document and reconstructs {@link pages}.
   * Existing `PdfPage` references continue to address the same page indices, but
   * callers should prefer reading `document.pages` again afterward.
   *
   * Raw edits do not describe their GUI impact. A viewer displaying this
   * document must therefore be refreshed explicitly—for `@pdfrx/viewer`, use
   * {@link https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshpages | PdfrxViewer.refreshPages()},
   * {@link https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#refreshdocument | PdfrxViewer.refreshDocument()},
   * or
   * {@link https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html#reloaddocument | PdfrxViewer.reloadDocument()}
   * according to the scope and whether PDFium itself must be reconstructed.
   *
   * @example Add a ViewerPreferences indirect dictionary to the catalog
   * ```ts
   * await document.editRawObjects(
   *   (editor) => {
   *     const preferences = editor.createDictionary({
   *       HideToolbar: { kind: 'boolean', value: true },
   *       DisplayDocTitle: { kind: 'boolean', value: true },
   *     });
   *     editor.setDictionaryValue(
   *       editor.catalog(),
   *       'ViewerPreferences',
   *       preferences.reference,
   *     );
   *   },
   *   { atomic: true },
   * );
   *
   * // The engine cannot infer which viewer caches the raw edit affects.
   * await viewer.refreshDocument();
   * ```
   *
   * @param edit - The edit value.
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async editRawObjects(
    edit: (editor: PdfRawObjectEditor) => void | Promise<void>,
    options: PdfRawObjectEditOptions = {},
  ): Promise<void> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    const editor = new RawPdfObjectEditor();
    await edit(editor);
    if (editor.operations.length === 0 && editor.createDictionaries.length === 0) return;

    if (!(options.atomic ?? false)) {
      await this.applyRawPatchInternal(editor.operations, { createDictionaries: editor.createDictionaries });
      return;
    }

    const copy = await this.createArrangementCopy(this._pages);
    try {
      await copy.applyRawPatchInternal(editor.operations, { createDictionaries: editor.createDictionaries });
      await this.adoptTransactionalCopy(copy);
    } catch (error) {
      if (!copy.isDisposed) await copy.dispose();
      throw error;
    }
  }

  /** Replaces this instance's native document only after a prepared copy is complete. */
  private async adoptTransactionalCopy(copy: PdfDocument): Promise<void> {
    const replacementPages = copy.pages.map((page) => page.toWorkerInfo());
    const oldHandles = {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      formInfo: this.formInfo,
    };

    if (this.formNotifyCallbackId !== null) {
      this.comm.unregisterCallback(this.formNotifyCallbackId);
      this.formNotifyCallbackId = null;
    }
    try {
      await this.comm.sendCommand('closeDocument', oldHandles);
    } catch (error) {
      this.ensureFormNotify();
      throw error;
    }

    if (copy.formNotifyCallbackId !== null) {
      this.comm.unregisterCallback(copy.formNotifyCallbackId);
      copy.formNotifyCallbackId = null;
    }
    this.docHandle = copy.docHandle;
    this.formHandle = copy.formHandle;
    this.formInfo = copy.formInfo;
    const identities = this._pages.map((page) => page.id);
    this._pages = replacementPages.map((page, index) => new PdfPage(this, page, identities[index]));
    this.nativePageCount = this._pages.length;
    this.arrangementDirty = false;
    for (const lender of this.borrowedFrom) lender.borrowers.delete(this);
    this.borrowedFrom.clear();
    this.formFieldSourceIndex.clear();
    this.calcSpecs = null;
    this.ensureFormNotify();

    // Transfer ownership of the replacement handles; disposing the temporary
    // wrapper must not close the document now owned by this instance.
    copy._isDisposed = true;
    copy.listeners.clear();
    copy.formInvalidateListeners.clear();
    copy.borrowedFrom.clear();
    copy.borrowers.clear();
    this.emit('pageStatusChanged', { pageNumbers: this._pages.map((page) => page.pageNumber) });
  }

  /**
   * Creates an independent, fully materialized document from the current
   * logical state. The caller owns the returned document and must dispose it.
   *
   * Pending page, outline, and Link edits are applied to the returned document,
   * whose {@link hasPendingChanges} is therefore `false`. The source document
   * on which this method is called is not materialized or otherwise modified;
   * its pending state remains unchanged.
   *
   * `catalog: "preserve"` chooses the sole imported source as its base when
   * possible and preserves that source's catalog. `catalog: "rebuild"` imports
   * the arranged pages into a new empty PDF and omits objects not reachable
   * from those pages, whether they originated in the source PDF or from
   * subsequent edits. Rebuilding does not inherit existing physical
   * document-level outlines, metadata, name trees, signatures, or AcroForm
   * configuration. Pending logical page, outline, and Link edits are still
   * applied to the returned document.
   *
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async createMaterializedCopy(
    options: PdfMaterializedCopyOptions = {},
  ): Promise<PdfDocument> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    let copy: PdfDocument;
    if ((options.catalog ?? 'preserve') === 'rebuild') {
      copy = await this.createCompactArrangementCopy();
    } else {
      const sourceDocuments = new Set(this._pages.map((page) => page.sourceDocument));
      const baseDocument = sourceDocuments.size === 1 ? this._pages[0]!.sourceDocument : this;
      copy = await baseDocument.createArrangementCopy(this._pages);
    }
    try {
      if (this.pendingOutline !== undefined) copy.pendingOutline = cloneOutline(this.pendingOutline);
      for (const [pageId, links] of this.pendingLinks) copy.pendingLinks.set(pageId, cloneLinkSpecs(links));
      await copy.materialize();
      return copy;
    } catch (error) {
      await copy.dispose();
      throw error;
    }
  }

  /** Imports the current arranged pages into a new empty PDF. */
  private async createCompactArrangementCopy(): Promise<PdfDocument> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    const result = await this.sendCommand('createNewDocument', {});
    if (isWorkerError(result)) {
      throw new Error(`Failed to create compact copy: ${result.errorCodeStr} (${result.errorCode})`);
    }
    const copy = new PdfDocument(this.comm, result, `${this.sourceName} (compact copy)`, null);
    try {
      copy.setPages(this._pages);
      await copy.materializePageArrangement();
      return copy;
    } catch (error) {
      await copy.dispose();
      throw error;
    }
  }

  /** Creates a materialized copy of `pages` using this document as its catalog base. */
  private async createArrangementCopy(pagesToEncode: readonly PdfPage[]): Promise<PdfDocument> {
    if (this._isDisposed) throw new Error(`Document ${this.sourceName} is disposed`);
    const result = await this.sendCommand('cloneDocument', { docHandle: this.docHandle });
    if (isWorkerError(result)) {
      throw new Error(`Failed to clone document ${this.sourceName}: ${result.errorCodeStr} (${result.errorCode})`);
    }
    const copy = new PdfDocument(this.comm, result, `${this.sourceName} (copy)`, null);
    try {
      const pages = pagesToEncode.map((page, index) => {
        if (page.sourceDocument.docHandle !== this.docHandle) return page;
        const copiedSource = copy.pages[page.sourcePageIndex];
        if (!copiedSource) {
          throw new Error(`Source page ${page.sourcePageIndex + 1} is missing from the document copy`);
        }
        return copiedSource
          .rotatedTo(page.rotation)
          .placedIn(copy, index + 1, page.id);
      });
      copy.setPages(pages);
      await copy.materializePageArrangement();
      return copy;
    } catch (error) {
      await copy.dispose();
      throw error;
    }
  }

  /**
   * Loads all AcroForm fields across the document's currently loaded pages,
   * grouped by fully-qualified name (widgets that share a name — e.g. a radio
   * group — merge into one field). Returns an empty array for documents without
   * a form. Reflects live values, including ones changed by
   * {@link setFormFieldValue} or interactive editing.
   *
   * @returns The resolved Promise.
   *
   */
  async loadFormFields(): Promise<PdfFormField[]> {
    if (this._isDisposed || !this.formHandle) return [];
    const byName = new Map<string, { field: PdfFormField; rects: PdfRect[] }>();
    const ordered: { field: PdfFormField; rects: PdfRect[] }[] = [];
    for (const page of this._pages) {
      if (page.sourceDocument.docHandle !== this.docHandle) continue; // imported pages carry their own form state
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
    const fields = ordered.map(({ field, rects }) => ({ ...field, rects }));
    this.lastFormValues = this.snapshotFormValues(fields);
    return fields;
  }

  /**
   * Returns the current value of the named field, or `undefined` if it is not found.
   *
   * @param name - The name to look up.
   * @returns The resolved Promise.
   *
   */
  async getFormFieldValue(name: string): Promise<string | undefined> {
    const fields = await this.loadFormFields();
    return fields.find((f) => f.name === name)?.value;
  }

  /**
   * Sets the value of the field identified by fully-qualified `name`, routed
   * through the form-fill module so the widget appearance regenerates and the
   * change is visible on the next render. When {@link formCalculationEnabled} is
   * set (the default), dependent calculated fields (`AFSimple_Calculate`) are
   * recomputed afterwards. Fires one `formFieldsChanged` event using the
   * supplied mutation origin (`api` by default). The interpretation of `value`
   * depends on the field type — see {@link PdfFormFieldValue}.
   *
   * @param name - The name to look up.
   * @param value - The value to use.
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async setFormFieldValue(
    name: string,
    value: PdfFormFieldValue,
    options: PdfFormMutationOptions = {},
  ): Promise<void> {
    await this.setFormFieldValues({ [name]: value }, options);
  }

  /**
   * Applies several field values as one form transaction, runs calculations
   * once, and emits one `formFieldsChanged` event containing the complete
   * direct + calculated before/after diff.
   *
   * @param values - The values to use.
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async setFormFieldValues(
    values: Readonly<Record<string, PdfFormFieldValue>>,
    options: PdfFormMutationOptions = {},
  ): Promise<void> {
    const requestedValues = structuredClone(values);
    const operation = this.formMutationLock.then(() => this.applyFormFieldValues(requestedValues, options));
    this.formMutationLock = operation.catch(() => {});
    await operation;
  }

  private async applyFormFieldValues(
    values: Readonly<Record<string, PdfFormFieldValue>>,
    options: PdfFormMutationOptions,
  ): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    this.formApiMutationDepth++;
    try {
      const before = this.snapshotFormValues(await this.loadFormFields());
      for (const [name, value] of Object.entries(values)) {
        await this.sendSetFormFieldValue(name, value);
      }
      if (this.formCalculationEnabled) await this.runFormCalculations();
      const afterFields = await this.loadFormFields();
      const after = this.snapshotFormValues(afterFields);
      const changes = this.diffFormValues(before, after);
      if (changes.length === 0) return;
      const origin = options.origin ?? 'api';
      this.emit('formFieldsChanged', {
        source: origin === 'user' ? 'user' : 'api',
        origin,
        transactionId: options.transactionId,
        actorId: options.actorId,
        changes,
        pageNumbers: [...new Set(afterFields
          .filter((field) => changes.some((change) => change.name === field.name))
          .map((field) => field.pageNumber))],
      });
    } finally {
      this.formApiMutationDepth--;
    }
  }

  private snapshotFormValues(fields: readonly PdfFormField[]): Map<string, PdfFormFieldValue> {
    return new Map(fields.filter((field) => field.name).map((field) => {
      let value: PdfFormFieldValue = field.value;
      if (field.type === 'checkBox') value = !!field.isChecked;
      else if (field.type === 'comboBox' || field.type === 'listBox') {
        // Choice writes are restored through FORM_SetIndexSelected, whose API
        // matches option labels rather than the field's export value. Keep the
        // selected labels even for a single-select field: PDFs commonly use a
        // different export value (e.g. "0") and display label (e.g. ideographic
        // space), in which case replaying `field.value` cannot select the item.
        value = field.options?.filter((option) => option.selected).map((option) => option.label) ?? [];
      }
      return [field.name, value] as const;
    }));
  }

  private diffFormValues(
    before: ReadonlyMap<string, PdfFormFieldValue>,
    after: ReadonlyMap<string, PdfFormFieldValue>,
  ): PdfFormFieldChange[] {
    const equal = (a: PdfFormFieldValue, b: PdfFormFieldValue): boolean =>
      Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((value, index) => value === b[index])
        : a === b;
    const changes: PdfFormFieldChange[] = [];
    for (const [name, afterValue] of after) {
      const beforeValue = before.get(name);
      if (beforeValue !== undefined && !equal(beforeValue, afterValue)) {
        changes.push({ name, before: beforeValue, after: afterValue });
      }
    }
    return changes;
  }

  /**
   * Loads all content annotations (ink, shapes, text markup, notes, free text —
   * not widgets/links/popups) across the current page arrangement, including
   * imported pages. Each result is tagged with its 1-based arrangement
   * `pageNumber`. Use {@link PdfPage.loadAnnotations} when only one page is
   * needed. If the same physical source page is placed more than once, its
   * shared annotations appear once per placement. Returns `[]` for a disposed
   * document.
   *
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async loadAnnotations(options: PdfLoadAnnotationsOptions = {}): Promise<PdfAnnotationObject[]> {
    if (this._isDisposed) return [];
    const all: PdfAnnotationObject[] = [];
    for (const page of this._pages) {
      all.push(...await page.loadAnnotations(options));
    }
    return all;
  }

  /**
   * Loads highlights across the current page arrangement. Use
   * {@link PdfPage.loadHighlights} for one page. Each result includes its
   * 1-based arrangement page number; imported and duplicate placements follow
   * the same semantics as {@link loadAnnotations}.
   *
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
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

  /** Applies a page-scoped add and emits the change from the arrangement document. @internal */
  async addAnnotationForPage(
    page: PdfPage,
    spec: PdfAnnotationSpec,
    options: PdfAnnotationMutationOptions = {},
  ): Promise<string> {
    if (this._isDisposed) throw new Error('Document is disposed');
    if (page.document !== this) throw new Error('Page does not belong to this document arrangement');
    const effectiveSpec = options.origin === 'remote' || options.origin === 'restore'
      ? { ...spec, actorId: options.actorId ?? spec.actorId }
      : { ...spec, actorId: options.actorId ?? spec.actorId, revision: undefined };
    if (effectiveSpec.subtype === 'link') {
      if (!effectiveSpec.linkTarget) throw new Error('Link annotation requires linkTarget');
      const id = effectiveSpec.id ?? createPdfLinkId();
      const links = await page.loadEditableLinkSpecs();
      page.stageLinkAnnotations([...links, linkSpecFromAnnotationSpec({
        ...effectiveSpec,
        id,
        linkTarget: effectiveSpec.linkTarget,
      })]);
      const storedSpec = { ...structuredClone(effectiveSpec), id, revision: effectiveSpec.revision ?? 1 };
      this.emitAnnotationChanges(
        [{ type: 'add', id, pageNumber: page.pageNumber, spec: storedSpec }],
        [{ id, pageNumber: page.pageNumber, before: null, after: storedSpec }],
        options,
      );
      return id;
    }
    const result = await page.sourceDocument.sendCommand('addAnnotation', {
      docHandle: page.sourceDocument.docHandle,
      pageIndex: page.sourcePageIndex,
      spec: page.annotationSpecToWorker(effectiveSpec),
    });
    const storedSpec = { ...structuredClone(effectiveSpec), id: result.id, revision: result.revision };
    page.sourceDocument.emitAnnotationSourceChange(
      page.sourcePageIndex,
      (pageNumber) => ({ type: 'add', id: result.id, pageNumber, spec: storedSpec }),
      (pageNumber) => ({ id: result.id, pageNumber, before: null, after: storedSpec }),
      options,
    );
    return result.id;
  }

  /** Applies a page-scoped update and emits the change from the arrangement document. @internal */
  async updateAnnotationForPage(
    page: PdfPage,
    id: string,
    spec: PdfAnnotationSpec,
    options: PdfAnnotationMutationOptions = {},
  ): Promise<string> {
    if (this._isDisposed) throw new Error('Document is disposed');
    if (page.document !== this) throw new Error('Page does not belong to this document arrangement');
    const before = await this.loadAnnotationSpec(page, id);
    const effectiveSpec = options.origin === 'remote' || options.origin === 'restore'
      ? { ...spec, actorId: options.actorId ?? spec.actorId }
      : { ...spec, actorId: options.actorId ?? spec.actorId, revision: undefined };
    if (before?.subtype === 'link' || effectiveSpec.subtype === 'link') {
      if (before?.subtype !== 'link' || effectiveSpec.subtype !== 'link') {
        throw new Error('Changing an annotation to or from link is not supported');
      }
      if (!effectiveSpec.linkTarget) throw new Error('Link annotation requires linkTarget');
      const links = await page.loadEditableLinkSpecs();
      const index = links.findIndex((link) => link.id === id);
      if (index < 0) throw new Error(`Annotation not found: ${id}`);
      links[index] = linkSpecFromAnnotationSpec({
        ...effectiveSpec,
        id,
        linkTarget: effectiveSpec.linkTarget,
      });
      page.stageLinkAnnotations(links);
      const storedSpec = {
        ...structuredClone(effectiveSpec),
        id,
        revision: (before.revision ?? 0) + 1,
      };
      this.emitAnnotationChanges(
        [{ type: 'update', id, pageNumber: page.pageNumber, spec: storedSpec }],
        [{ id, pageNumber: page.pageNumber, before, after: storedSpec }],
        options,
      );
      return id;
    }
    const result = await page.sourceDocument.sendCommand('updateAnnotation', {
      docHandle: page.sourceDocument.docHandle,
      pageIndex: page.sourcePageIndex,
      id,
      spec: page.annotationSpecToWorker(effectiveSpec),
      ...(options.preserveAppearance ? { preserveAppearance: true } : {}),
    });
    const storedSpec = { ...structuredClone(effectiveSpec), id: result.id, revision: result.revision };
    page.sourceDocument.emitAnnotationSourceChange(
      page.sourcePageIndex,
      (pageNumber) => ({ type: 'update', id: result.id, pageNumber, spec: storedSpec }),
      (pageNumber) => ({ id: result.id, pageNumber, before, after: storedSpec }),
      options,
    );
    return result.id;
  }

  /** Applies a page-scoped removal and emits the change from the arrangement document. @internal */
  async removeAnnotationForPage(
    page: PdfPage,
    id: string,
    options: PdfAnnotationMutationOptions = {},
  ): Promise<boolean> {
    if (this._isDisposed) throw new Error('Document is disposed');
    if (page.document !== this) throw new Error('Page does not belong to this document arrangement');
    const before = await this.loadAnnotationSpec(page, id);
    if (before?.subtype === 'link') {
      const links = await page.loadEditableLinkSpecs();
      const remaining = links.filter((link) => link.id !== id);
      if (remaining.length === links.length) return false;
      page.stageLinkAnnotations(remaining);
      this.emitAnnotationChanges(
        [{ type: 'remove', id, pageNumber: page.pageNumber }],
        [{ id, pageNumber: page.pageNumber, before, after: null }],
        options,
      );
      return true;
    }
    const result = await page.sourceDocument.sendCommand('removeAnnotation', {
      docHandle: page.sourceDocument.docHandle,
      pageIndex: page.sourcePageIndex,
      id,
    });
    if (result.ok) {
      page.sourceDocument.emitAnnotationSourceChange(
        page.sourcePageIndex,
        (pageNumber) => ({ type: 'remove', id, pageNumber }),
        (pageNumber) => ({ id, pageNumber, before, after: null }),
        options,
      );
    }
    return result.ok;
  }

  /**
   * Exports a versioned, structured-cloneable snapshot across the current
   * arrangement. This stays on `PdfDocument` because snapshots can span pages;
   * use {@link PdfPage.loadAnnotations} for a single-page read. A physical
   * source page placed more than once is exported once, using its first
   * arrangement page number, because all placements share the same stable ids
   * and annotation state.
   *
   * @returns The resulting Promise.
   *
   */
  async exportAnnotations(): Promise<PdfAnnotationSnapshot> {
    const annotations = await this.loadUniqueSourceAnnotations();
    return {
      version: 1,
      annotations: annotations.map((annotation) => ({
        id: annotation.id,
        pageNumber: annotation.pageNumber,
        spec: annotationObjectToSpec(annotation),
      })),
    };
  }

  /**
   * Restores a document-wide snapshot while preserving ids and emitting one
   * `annotationsChanged` notification batch. The PDFium mutations are
   * sequential, not transactional: a later failure can leave earlier changes
   * applied.
   *
   * @param snapshot - The current immutable session snapshot.
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async restoreAnnotations(snapshot: PdfAnnotationSnapshot, options: PdfRestoreAnnotationsOptions = {}): Promise<void> {
    if (snapshot.version !== 1) throw new Error(`Unsupported annotation snapshot version: ${String(snapshot.version)}`);
    const origin = options.origin ?? 'restore';
    const existing = await this.loadUniqueSourceAnnotations();
    const incomingIds = new Set(snapshot.annotations.map((item) => item.id));
    const changes: PdfAnnotationChange[] = [];
    if ((options.mode ?? 'replace') === 'replace') {
      for (const annotation of existing) {
        if (!incomingIds.has(annotation.id) && await this.removeAnnotationRaw(annotation.pageNumber, annotation.id)) {
          changes.push({ type: 'remove', id: annotation.id, pageNumber: annotation.pageNumber });
        }
      }
    }
    const existingIds = new Set(existing.map((annotation) => annotation.id));
    for (const item of snapshot.annotations) {
      const spec = { ...structuredClone(item.spec), id: item.id };
      const page = this.pageForAnnotation(item.pageNumber);
      const type = existingIds.has(item.id) ? 'update' : 'add';
      const resultId = spec.subtype === 'link'
        ? await this.writeLinkAnnotationRaw(page, type, item.id, spec)
        : (await page.sourceDocument.sendCommand(type === 'update' ? 'updateAnnotation' : 'addAnnotation', {
            docHandle: page.sourceDocument.docHandle,
            pageIndex: page.sourcePageIndex,
            ...(type === 'update' ? { id: item.id } : {}),
            ...(type === 'update' && options.preserveAppearance ? { preserveAppearance: true } : {}),
            spec: page.annotationSpecToWorker(spec),
          } as never)).id;
      changes.push({ type, id: resultId, pageNumber: item.pageNumber, spec });
    }
    this.emitAnnotationChanges(
      changes,
      this.annotationHistoryFromSnapshots(existing, changes),
      { origin, transactionId: options.transactionId, actorId: options.actorId },
    );
  }

  /**
   * Routes a cross-page synchronization batch to its arrangement pages and
   * emits one `annotationsChanged` event after the applied operations. This is
   * a notification batch, not a rollback transaction: a later failure can
   * leave earlier PDFium mutations applied. Use page methods for independent
   * local CRUD on one page.
   *
   * @param changes - The changes to apply.
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async applyAnnotationChanges(changes: readonly PdfAnnotationChange[], options: PdfAnnotationMutationOptions = {}): Promise<void> {
    const applied: PdfAnnotationChange[] = [];
    const historyChanges: PdfAnnotationHistoryChange[] = [];
    for (const change of changes) {
      const page = this.pageForAnnotation(change.pageNumber);
      const before = await this.loadAnnotationSpec(page, change.id);
      if (change.type === 'remove') {
        if (await this.removeAnnotationRaw(change.pageNumber, change.id)) {
          applied.push(change);
          historyChanges.push({ id: change.id, pageNumber: change.pageNumber, before, after: null });
        }
        continue;
      }
      const spec = { ...structuredClone(change.spec), id: change.id };
      const command = change.type === 'add' ? 'addAnnotation' : 'updateAnnotation';
      const resultId = spec.subtype === 'link'
        ? await this.writeLinkAnnotationRaw(page, change.type, change.id, spec)
        : (await page.sourceDocument.sendCommand(command, {
            docHandle: page.sourceDocument.docHandle,
            pageIndex: page.sourcePageIndex,
            ...(command === 'updateAnnotation' ? { id: change.id } : {}),
            ...(command === 'updateAnnotation' && options.preserveAppearance ? { preserveAppearance: true } : {}),
            spec: page.annotationSpecToWorker(spec),
          } as never)).id;
      applied.push({ ...change, id: resultId, spec });
      historyChanges.push({ id: resultId, pageNumber: change.pageNumber, before, after: spec });
    }
    this.emitAnnotationChanges(applied, historyChanges, options);
  }

  private async removeAnnotationRaw(pageNumber: number, id: string): Promise<boolean> {
    const page = this.pageForAnnotation(pageNumber);
    const existing = await this.loadAnnotationSpec(page, id);
    if (existing?.subtype === 'link') {
      const links = await page.loadEditableLinkSpecs();
      const remaining = links.filter((link) => link.id !== id);
      if (remaining.length === links.length) return false;
      page.stageLinkAnnotations(remaining);
      return true;
    }
    const result = await page.sourceDocument.sendCommand('removeAnnotation', {
      docHandle: page.sourceDocument.docHandle,
      pageIndex: page.sourcePageIndex,
      id,
    });
    return result.ok;
  }

  private async writeLinkAnnotationRaw(
    page: PdfPage,
    type: 'add' | 'update',
    id: string,
    spec: PdfAnnotationSpec,
  ): Promise<string> {
    if (spec.subtype !== 'link' || !spec.linkTarget) throw new Error('Link annotation requires linkTarget');
    const links = await page.loadEditableLinkSpecs();
    const writable = linkSpecFromAnnotationSpec({ ...spec, id, linkTarget: spec.linkTarget });
    if (type === 'add') {
      if (links.some((link) => link.id === id)) throw new Error(`Annotation already exists: ${id}`);
      page.stageLinkAnnotations([...links, writable]);
    } else {
      const index = links.findIndex((link) => link.id === id);
      if (index < 0) throw new Error(`Annotation not found: ${id}`);
      links[index] = writable;
      page.stageLinkAnnotations(links);
    }
    return id;
  }

  /**
   * Loads each physical page once, using its first arrangement placement for
   * the snapshot page number. Duplicate placements share annotation state and
   * must not produce duplicate stable ids in export/restore bookkeeping.
   *
   */
  private async loadUniqueSourceAnnotations(): Promise<PdfAnnotationObject[]> {
    const seen = new Set<string>();
    const result: PdfAnnotationObject[] = [];
    for (const page of this._pages) {
      if (seen.has(page.sourceKey)) continue;
      seen.add(page.sourceKey);
      result.push(...await page.loadAnnotations());
    }
    return result;
  }

  private emitAnnotationChanges(
    changes: readonly PdfAnnotationChange[],
    historyChanges: readonly PdfAnnotationHistoryChange[],
    options: PdfAnnotationMutationOptions,
  ): void {
    if (changes.length === 0) return;
    this.emit('annotationsChanged', {
      origin: options.origin ?? 'api',
      transactionId: options.transactionId,
      actorId: options.actorId,
      changes,
      historyChanges,
      pageNumbers: [...new Set(changes.map((change) => change.pageNumber))],
    });
  }

  /**
   * Notifies every open arrangement that currently places one physical source
   * page. This keeps both the source document's viewer and all borrowing
   * document viewers current after page-scoped CRUD.
   *
   */
  private emitAnnotationSourceChange(
    sourcePageIndex: number,
    changeForPage: (pageNumber: number) => PdfAnnotationChange,
    historyChangeForPage: (pageNumber: number) => PdfAnnotationHistoryChange,
    options: PdfAnnotationMutationOptions,
  ): void {
    for (const target of [this, ...this.borrowers]) {
      const changes = target._pages
        .filter((page) =>
          page.sourceDocument.docHandle === this.docHandle && page.sourcePageIndex === sourcePageIndex
        )
        .map((page) => changeForPage(page.pageNumber));
      target.emitAnnotationChanges(
        changes,
        changes.map((change) => historyChangeForPage(change.pageNumber)),
        options,
      );
    }
  }

  private async loadAnnotationSpec(page: PdfPage, id: string): Promise<PdfAnnotationSpec | null> {
    const annotation = (await page.loadAnnotations()).find((item) => item.id === id);
    return annotation ? annotationObjectToSpec(annotation) : null;
  }

  private annotationHistoryFromSnapshots(
    before: readonly PdfAnnotationObject[],
    changes: readonly PdfAnnotationChange[],
  ): PdfAnnotationHistoryChange[] {
    const beforeById = new Map(before.map((annotation) => [annotation.id, annotationObjectToSpec(annotation)]));
    return changes.map((change) => ({
      id: change.id,
      pageNumber: change.pageNumber,
      before: beforeById.get(change.id) ?? null,
      after: change.type === 'remove' ? null : change.spec,
    }));
  }

  /**
   * Resolves a 1-based arrangement position to its physical page. Annotation
   * writes are dispatched to that page's owning document, so arrangements may
   * freely mix pages imported from other open documents.
   * @internal
   *
   */
  private pageForAnnotation(pageNumber: number): PdfPage {
    const page = this._pages[pageNumber - 1];
    if (!page) throw new Error(`Invalid page number: ${pageNumber}`);
    return page;
  }

  /**
   * Sends one form-field write to the worker (find the field's page, dispatch
   * the typed command). No calculation or event — the primitive shared by
   * {@link setFormFieldValue} and {@link runFormCalculations}.
   * @internal
   *
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
   *
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
   *
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
   *
   */
  async formOpenPage(page: PdfPage): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    if (this.lastFormValues.size === 0) await this.loadFormFields();
    await this.sendCommand('formOpenPage', {
      docHandle: this.docHandle,
      formHandle: this.formHandle,
      pageIndex: page.sourcePageIndex,
    });
  }

  /**
   * Reserved for internal use only (the viewer). Closes an interactive form page.
   * @internal
   *
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
   *
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
   *
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
   *
   */
  async formKillFocus(): Promise<void> {
    if (this._isDisposed || !this.formHandle) return;
    await this.sendCommand('formKillFocus', { docHandle: this.docHandle, formHandle: this.formHandle });
  }

  /**
   * Serializes `action` against previously scheduled page-loading work so that
   * {@link loadPagesProgressively} and {@link reloadPages} never overlap.
   * @internal
   *
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
   *
   */
  private static parsePermissions(wire: WorkerDocument): PdfPermissions | null {
    if (wire.permissions >= 0 && wire.securityHandlerRevision >= 0) {
      return new PdfPermissions(wire.permissions, wire.securityHandlerRevision);
    }
    return null;
  }
}

/**
 * Spec for constructing a *proxy* page: a stand-in that presents a different
 * page number and/or rotation for an existing page without touching the
 * underlying PDF. Built internally while arranging or rotating pages.
 * @internal
 *
 */
export interface PdfPageProxySpec {
  readonly basePage: PdfPage;
  readonly document: PdfDocument;
  readonly pageNumber: number;
  readonly rotation: PdfPageRotation;
  readonly id?: PdfPageId;
}

/**
 * A page of a document. Obtain instances via {@link PdfDocument.pages}; do not
 * construct directly.
 *
 * A page has two identities that usually coincide but need not: where it sits
 * in the document ({@link pageNumber}, its `rotation`) and which physical page
 * of which PDF it draws ({@link sourcePage}). {@link rotatedTo} returns a
 * *proxy* page that changes the effective rotation while sharing the physical
 * page. {@link PdfDocument.setPages} similarly assigns placement and page
 * numbers from array order, which is what makes rearrangement free.
 *
 */
export class PdfPage {
  /** @internal */
  constructor(
    /** The document holding the physical page this one draws. */
    readonly sourceDocument: PdfDocument,
    src: WorkerPageInfo | PdfPageProxySpec,
    id: PdfPageId = createPdfPageId(),
  ) {
    if ('basePage' in src) {
      // Proxies are never nested: wrapping a proxy re-wraps its base instead, so
      // `basePage` is always a real page and no unwrap-the-chain walk is needed.
      const base = src.basePage.sourcePage;
      this.document = src.document;
      this.id = src.id ?? src.basePage.id;
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
      this.document = sourceDocument;
      this.id = id;
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

  /**
   * Document whose current arrangement contains this page.
   *
   * For an imported page this differs from {@link sourceDocument}, which owns
   * the physical PDF page and its annotations and form widgets.
   *
   */
  readonly document: PdfDocument;
  /**
   * Opaque logical-page identity. Placement and rotation proxies retain it;
   * {@link duplicate} creates a distinct identity without copying PDF data.
   *
   */
  readonly id: PdfPageId;
  /** 1-based page number — the position in {@link PdfDocument.pages}, not in the PDF. */
  readonly pageNumber: number;
  /** Page width in points (1/72 inch), at this page's `rotation`. */
  readonly width: number;
  /** Page height in points (1/72 inch), at this page's `rotation`. */
  readonly height: number;
  /** Effective page rotation (clockwise); on a rotated proxy this differs from the rotation baked into the PDF. */
  readonly rotation: PdfPageRotation;
  /** False for pages not yet materialized during progressive loading. */
  readonly isLoaded: boolean;
  /** The real page this one stands in for, or `null` if this *is* a real page. */
  readonly basePage: PdfPage | null;
  /** Reserved for internal use only. 0-based index of the physical page within {@link sourceDocument}. @internal */
  readonly sourcePageIndex: number;
  /** Reserved for internal use only. Rotation baked into the PDF for the physical page. @internal */
  readonly sourceRotation: PdfPageRotation;
  /** Left of the page's bounding box; text/link rects are shifted by it internally. @internal */
  private readonly bbLeft: number;
  /** Bottom of the page's bounding box; text/link rects are shifted by it internally. @internal */
  private readonly bbBottom: number;

  /** Recreates the worker page metadata when a transactional document copy is adopted. */
  /** @internal */
  toWorkerInfo(): WorkerPageInfo {
    return {
      pageIndex: this.sourcePageIndex,
      width: this.width,
      height: this.height,
      rotation: pdfPageRotationToIndex(this.rotation),
      isLoaded: this.isLoaded,
      bbLeft: this.bbLeft,
      bbBottom: this.bbBottom,
    };
  }

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
   *
   * @param other - The other value (PdfPage).
   * @returns Whether the condition is satisfied.
   *
   */
  hasSameSource(other: PdfPage): boolean {
    return other.sourceDocument.docHandle === this.sourceDocument.docHandle
      && other.sourcePageIndex === this.sourcePageIndex;
  }

  /**
   * Identity of the physical page, independent of where it sits in the document.
   * Two pages with the same key produce the same text and links.
   *
   */
  get sourceKey(): string {
    return `${this.sourceDocument.docHandle}:${this.sourcePageIndex}`;
  }

  /**
   * Identity of what {@link render} draws — {@link sourceKey} plus rotation.
   * Cache bitmaps under this and moving a page around costs nothing.
   *
   */
  get renderKey(): string {
    return `${this.sourceKey}:${this.rotation}`;
  }

  /**
   * Returns a lightweight proxy over the same physical page with a new logical
   * identity. No PDF data is copied or materialized, so this operation is
   * effectively free. The returned page still renders the same physical page;
   * only placement identity is separated.
   *
   * This matters when one {@link PdfPage} is placed more than once. Reusing the
   * same object also reuses its opaque {@link id}, so an ID-based {@link dest}
   * can identify the page but not a particular occurrence:
   *
   * ```ts
   * const [page, ...rest] = document.pages;
   * document.setPages([page!, ...rest, page!]);
   *
   * const ambiguous = page!.dest({
   *   by: 'id',
   *   command: 'fit',
   *   params: [],
   * });
   * // Both placements have the same ID. Following `ambiguous` selects one
   * // matching placement; callers must not rely on which one is selected.
   * ```
   *
   * Call `duplicate()` before arranging the second occurrence when destinations
   * must distinguish them:
   *
   * ```ts
   * const [page, ...rest] = document.pages;
   * const secondPlacement = page!.duplicate();
   * document.setPages([page!, ...rest, secondPlacement]);
   *
   * const firstDest = page!.dest({
   *   by: 'id',
   *   command: 'fit',
   *   params: [],
   * });
   * const secondDest = secondPlacement.dest({
   *   by: 'id',
   *   command: 'fit',
   *   params: [],
   * });
   * ```
   *
   * The two destinations now follow separate placements, while both pages
   * continue to use the same underlying PDF page data.
   *
   * @returns The resulting PdfPage.
   *
   */
  duplicate(): PdfPage {
    return new PdfPage(this.sourceDocument, {
      basePage: this,
      document: this.document,
      pageNumber: this.pageNumber,
      rotation: this.rotation,
      id: createPdfPageId(),
    });
  }

  /**
   * Creates an immutable destination for this logical page or its current
   * 1-based position.
   *
   * An ID-based destination is ambiguous when the same page identity occurs in
   * multiple arrangement slots. Use {@link duplicate} when destinations must
   * distinguish repeated placements; see that method for examples and details.
   *
   * @param options - Options that customize the operation.
   * @returns The resulting PdfDest.
   *
   */
  dest(options: PdfDestOptions): PdfDest {
    const common = { command: options.command, params: [...options.params] };
    return options.by === 'id'
      ? { by: 'id', pageId: this.id, ...common }
      : { by: 'pageNumber', pageNumber: this.pageNumber, ...common };
  }

  /** Returns a placement proxy owned by `document`. @internal */
  placedIn(document: PdfDocument, pageNumber: number, id: PdfPageId = this.id): PdfPage {
    if (document === this.document && pageNumber === this.pageNumber && id === this.id) return this;
    return new PdfPage(this.sourceDocument, { basePage: this, document, pageNumber, rotation: this.rotation, id });
  }

  /**
   * Creates a page-placement proxy with the requested absolute rotation.
   *
   * Calling this method alone does **not** modify the PDF or
   * {@link PdfDocument.pages}. Pass the returned page to
   * {@link PdfDocument.setPage} to replace one placement, or include it in the
   * array passed to {@link PdfDocument.setPages}. Those methods update the
   * in-memory arrangement synchronously; {@link PdfDocument.encodePdf} or
   * {@link PdfDocument.materialize} later writes the arrangement into the
   * physical PDF.
   *
   * `rotation` is clockwise and absolute: `90` means the page is displayed at
   * 90 degrees regardless of the page's current `rotation` property. If it
   * already has the requested rotation, this method returns `this`.
   *
   * @example Rotate the third page to an absolute 90 degrees
   * ```ts
   * const page = doc.pages[2]!;
   * doc.setPage(3, page.rotatedTo(90));
   * ```
   *
   * @param rotation - The clockwise page rotation, in 90-degree steps.
   * @returns The resulting PdfPage.
   *
   */
  rotatedTo(rotation: PdfPageRotation): PdfPage {
    if (rotation === this.rotation) return this;
    return new PdfPage(this.sourceDocument, {
      basePage: this,
      document: this.document,
      pageNumber: this.pageNumber,
      rotation,
    });
  }

  /**
   * Creates a page-placement proxy rotated clockwise by `delta` relative to its
   * current `rotation` property.
   *
   * This does not modify the document by itself. Apply the returned proxy with
   * {@link PdfDocument.setPage} or {@link PdfDocument.setPages}; use
   * {@link PdfDocument.encodePdf} or {@link PdfDocument.materialize} only when
   * the in-memory arrangement must be written into the physical PDF.
   *
   * @example Rotate the current first-page placement by 90 degrees
   * ```ts
   * doc.setPage(1, doc.pages[0]!.rotatedBy(90));
   * ```
   *
   * @param delta - The amount of change to apply.
   * @returns The resulting PdfPage.
   *
   */
  rotatedBy(delta: PdfPageRotation): PdfPage {
    return this.rotatedTo(pdfPageRotationFromIndex((this.rotation + delta) / 90));
  }

  /**
   * Creates a page-placement proxy rotated 90 degrees clockwise relative to
   * this page.
   *
   * Calling this method does not change {@link PdfDocument.pages}. Apply the
   * result with {@link PdfDocument.setPage} or {@link PdfDocument.setPages}.
   *
   * @example
   * ```ts
   * doc.setPage(1, doc.pages[0]!.rotatedCW90());
   * ```
   *
   * @returns The resulting PdfPage.
   *
   */
  rotatedCW90(): PdfPage {
    return this.rotatedBy(90);
  }

  /**
   * Creates a page-placement proxy rotated 90 degrees counter-clockwise
   * relative to this page.
   *
   * Calling this method does not change {@link PdfDocument.pages}. Apply the
   * result with {@link PdfDocument.setPage} or {@link PdfDocument.setPages}.
   *
   * @example
   * ```ts
   * doc.setPage(1, doc.pages[0]!.rotatedCCW90());
   * ```
   *
   * @returns The resulting PdfPage.
   *
   */
  rotatedCCW90(): PdfPage {
    return this.rotatedBy(270);
  }

  /**
   * Creates a page-placement proxy rotated 180 degrees relative to this page.
   *
   * Calling this method does not change {@link PdfDocument.pages}. Apply the
   * result with {@link PdfDocument.setPage} or {@link PdfDocument.setPages}.
   *
   * @example Rotate several placements in one arrangement update
   * ```ts
   * const pages = doc.pages.map((page, index) =>
   *   index === 0 || index === 2 ? page.rotated180() : page,
   * );
   * doc.setPages(pages);
   * ```
   *
   * @returns The resulting PdfPage.
   *
   */
  rotated180(): PdfPage {
    return this.rotatedBy(180);
  }

  /**
   * Reserved for internal use only. Re-points this page at a freshly loaded
   * `base` (same physical page, new metadata) while keeping any proxy overrides.
   * @internal
   *
   */
  rebasedOn(base: PdfPage): PdfPage {
    if (this.basePage === null) return new PdfPage(base.sourceDocument, base.toWorkerInfo(), this.id);
    return new PdfPage(base.sourceDocument, {
      basePage: base,
      document: this.document,
      pageNumber: this.pageNumber,
      rotation: this.rotation,
      id: this.id,
    });
  }

  /**
   * Reserved for internal use only. This page as a source slot for
   * {@link PdfDocument.materialize}.
   * @internal
   *
   */
  toAssembleSource(): PdfAssembleSource {
    return {
      document: this.sourceDocument,
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
   *
   * @param options - Options that customize the operation.
   * @returns The rendered Promise.
   *
   */
  async render(options: PdfPageRenderOptions = {}): Promise<PdfImage | null> {
    if (this.sourceDocument.isDisposed) return null;
    const fullWidth = options.fullWidth ?? this.width;
    const fullHeight = options.fullHeight ?? this.height;
    const width = options.width ?? Math.floor(fullWidth);
    const height = options.height ?? Math.floor(fullHeight);

    const result = await this.sourceDocument.enqueueRender(
      () =>
        this.sourceDocument.sendCommand('renderPage', {
          docHandle: this.sourceDocument.docHandle,
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
          formHandle: this.sourceDocument.formHandle,
        }),
      options.cancellationToken,
    );
    if (!result) return null; // cancelled
    this.sourceDocument.updateMissingFonts(result.missingFonts);
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
   *
   * @returns The resulting PdfPageRenderCancellationToken.
   *
   */
  createCancellationToken(): PdfPageRenderCancellationToken {
    return new PdfPageRenderCancellationToken();
  }

  /**
   * Loads the full text of the page with one bounding rect per UTF-16 code unit
   * (in page coordinates). Returns `null` if the document is disposed or the
   * page is not yet loaded (progressive loading).
   *
   * @returns The resolved Promise.
   *
   */
  async loadText(): Promise<PdfPageRawText | null> {
    if (this.sourceDocument.isDisposed || !this.isLoaded) return null;
    const result = await this.sourceDocument.sendCommand('loadText', {
      docHandle: this.sourceDocument.docHandle,
      pageIndex: this.sourcePageIndex,
    });
    this.sourceDocument.updateMissingFonts(result.missingFonts);
    return {
      fullText: result.fullText,
      charRects: result.charRects.map((r) => this.rectFromWorker(r)),
    };
  }

  /**
   * Loads link annotations on the page and, when
   * `enableAutoLinkDetection` is true (the default), URL-like text detected in
   * the page content. Pending annotation-CRUD changes are returned instead of
   * physical Link annotations while retaining transient detected URLs.
   *
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async loadLinks(options: { enableAutoLinkDetection?: boolean } = {}): Promise<PdfLink[]> {
    const loaded = await this.loadLinksFromWorker(options);
    const pending = this.document.pendingLinksFor(this.id);
    if (pending === undefined) return loaded;
    const staged = pending.map((link) => pdfLinkFromSpec(link));
    return options.enableAutoLinkDetection === false
      ? staged
      : [...staged, ...loaded.filter((link) => link.kind === 'detected')];
  }

  /** Loads only the physical PDF's links, bypassing staged replacements. */
  private async loadLinksFromWorker(options: { enableAutoLinkDetection?: boolean } = {}): Promise<PdfLink[]> {
    if (this.sourceDocument.isDisposed || !this.isLoaded) return [];
    const result = await this.sourceDocument.sendCommand('loadLinks', {
      docHandle: this.sourceDocument.docHandle,
      pageIndex: this.sourcePageIndex,
      enableAutoLinkDetection: options.enableAutoLinkDetection ?? true,
    });
    return result.links.map((link) => ({
      kind: link.kind ?? 'annotation',
      id: link.id ?? null,
      rects: link.rects.map((r) => this.rectFromWorker(r)),
      target: link.dest
        ? {
            kind: 'destination' as const,
            // Resolved against the document the page physically lives in. For
            // an imported page, the PDF target still belongs to that source.
            dest: pdfDestFromWorker(link.dest, this.sourceDocument)!,
          }
        : { kind: 'uri' as const, url: link.url ?? '' },
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
   * Stages the editable Link annotations on this logical page. Other annotation
   * subtypes and unsupported Link actions are preserved when
   * {@link PdfDocument.materialize} writes the pending change.
   *
   */
  /** @internal Stages the complete Link list used by ordinary annotation CRUD. */
  stageLinkAnnotations(links: readonly PdfLinkSpec[]): void {
    if (this.document.isDisposed || !this.isLoaded) return;
    validateLinkSpecs(links);
    this.document.stageLinks(this.id, links, this.pageNumber);
  }

  /** Writes staged Link annotations to the physical page represented by this page. @internal */
  async writeLinksNow(links: readonly PdfLinkSpec[]): Promise<void> {
    for (const link of links) {
      if (!(link.rect.left < link.rect.right) || !(link.rect.bottom < link.rect.top)) {
        throw new RangeError('Link rectangle must have positive width and height');
      }
      if (link.target.kind === 'uri' && link.target.url.length === 0) {
        throw new Error('Link URI must not be empty');
      }
      if (link.target.kind === 'destination') validateDestination(link.target.dest);
    }

    const document = this.document;
    const currentPage = this;
    const pageReferences = await loadRawPageReferences(document);
    const pageReference = pageReferences[currentPage.sourcePageIndex];
    if (pageReference === undefined) throw new Error(`PDF page ${currentPage.sourcePageIndex + 1} is missing`);
    const pageObject = await readRawDictionary(document, pageReference);
    const annotationItems = await readRawArrayEntry(document, pageObject.entries.Annots);
    const supportedIds = new Set(
      (await currentPage.loadLinksFromWorker({ enableAutoLinkDetection: false }))
        .filter((link) => link.kind === 'annotation' && link.id !== null)
        .map((link) => link.id!),
    );
    const preserved: PdfRawPatchValue[] = [];
    for (let index = 0; index < annotationItems.length; index++) {
      const item = annotationItems[index]!;
      const annotation = await resolveRawDictionary(document, item);
      const isLink = annotation?.entries.Subtype?.kind === 'name'
        && annotation.entries.Subtype.value === 'Link';
      const id = annotation ? decodeRawText(annotation.entries.NM) ?? `@${index}` : null;
      if (!isLink || id === null || !supportedIds.has(id)) preserved.push(item);
    }

    const destinationPageReferences = pageReferences;
    await document.editRawObjects((editor) => {
      const created = links.map((link) => {
        const raw = currentPage.rectToWorker(link.rect);
        const target = editor.createDictionary({
          Type: rawName('Annot'),
          Subtype: rawName('Link'),
          Rect: {
            kind: 'array',
            items: [rawNumber(raw[0]), rawNumber(raw[3]), rawNumber(raw[2]), rawNumber(raw[1])],
          },
          NM: rawText(link.id ?? createPdfLinkId()),
        });
        const metadata = link.annotation;
        if (metadata?.title) editor.setDictionaryValue(target, 'T', rawText(metadata.title));
        if (metadata?.content) editor.setDictionaryValue(target, 'Contents', rawText(metadata.content));
        if (metadata?.subject) editor.setDictionaryValue(target, 'Subj', rawText(metadata.subject));
        if (metadata?.modificationDate) editor.setDictionaryValue(target, 'M', rawText(metadata.modificationDate));
        if (metadata?.creationDate) editor.setDictionaryValue(target, 'CreationDate', rawText(metadata.creationDate));
        if (link.target.kind === 'uri') {
          editor.setDictionaryValue(target, 'A', {
            kind: 'dictionary',
            entries: { S: rawName('URI'), URI: rawByteString(link.target.url) },
          });
        } else {
          const resolved = document.resolveDest(link.target.dest);
          if (!resolved) throw new Error('Link destination does not resolve');
          const destinationReference = destinationPageReferences[resolved.pageNumber - 1];
          if (destinationReference === undefined) throw new Error(`Link destination page ${resolved.pageNumber} is missing`);
          editor.setDictionaryValue(target, 'Dest', {
            kind: 'array',
            items: [
              rawReference(destinationReference),
              rawName(pdfDestinationName(resolved.command)),
              ...resolved.params.map((value) => value === null ? { kind: 'null' as const } : rawNumber(value)),
            ],
          });
        }
        return target;
      });
      editor.setDictionaryValue(editor.object(pageReference), 'Annots', {
        kind: 'array',
        items: [...preserved, ...created.map((item) => item.reference)],
      });
    }, { atomic: true });
  }

  /**
   * Loads the AcroForm fields whose widgets sit on this page, grouped by
   * fully-qualified name. Rects are in PDF page coordinates (bounding-box
   * relative, like {@link loadLinks}). Returns an empty array if the document is
   * disposed, has no form, or the page is not yet loaded.
   *
   * @returns The resolved Promise.
   *
   */
  async loadFormFields(): Promise<PdfFormField[]> {
    if (this.sourceDocument.isDisposed || !this.isLoaded || !this.sourceDocument.formHandle) return [];
    const result = await this.sourceDocument.sendCommand('loadFormFields', {
      docHandle: this.sourceDocument.docHandle,
      formHandle: this.sourceDocument.formHandle,
      pageIndex: this.sourcePageIndex,
    });
    return groupWorkerFormFields(result.fields, this);
  }

  /**
   * Loads the editable annotations on this page (including Link annotations,
   * but not widgets/popups), with rects and geometry in
   * bounding-box-relative page coordinates (like {@link loadLinks}). Returns an
   * empty array if the document is disposed or the page is not yet loaded.
   *
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async loadAnnotations(options: PdfLoadAnnotationsOptions = {}): Promise<PdfAnnotationObject[]> {
    if (this.sourceDocument.isDisposed || !this.isLoaded) return [];
    const result = await this.sourceDocument.sendCommand('loadAnnotations', {
      docHandle: this.sourceDocument.docHandle,
      pageIndex: this.sourcePageIndex,
    });
    const annotations = [
      ...result.annotations.map((a) => this.annotationFromWorker(a)),
      ...(await this.loadLinks({ enableAutoLinkDetection: false }))
        .filter((link): link is PdfLink & { kind: 'annotation'; id: string } =>
          link.kind === 'annotation' && link.id !== null && link.rects.length > 0
        )
        .map((link) => this.annotationFromLink(link)),
    ];
    if (options.subtype === undefined) return annotations;
    const subtypes = new Set(Array.isArray(options.subtype) ? options.subtype : [options.subtype]);
    return annotations.filter((annotation) => subtypes.has(annotation.subtype));
  }

  /**
   * Loads highlight annotations on this page. Unlike
   * {@link PdfDocument.loadHighlights}, this performs no document-wide scan.
   * With `includeText`, only this page's text is loaded and intersected with the
   * highlight quadpoints.
   *
   * @param options - Options that customize the operation.
   * @returns The resolved Promise.
   *
   */
  async loadHighlights(options: PdfLoadHighlightsOptions = {}): Promise<PdfHighlightObject[]> {
    const annotations = await this.loadAnnotations({ subtype: 'highlight' });
    const highlights: PdfHighlightObject[] = annotations.map((annotation) => ({
      ...annotation,
      subtype: 'highlight',
      text: null,
    }));
    if (!options.includeText || highlights.length === 0) return highlights;
    const text = await this.loadText();
    return highlights.map((highlight) => ({
      ...highlight,
      text: extractHighlightText(highlight, text),
    }));
  }

  /**
   * Adds an annotation to this page and returns its id.
   *
   * The id is stored in the PDF annotation dictionary's `/NM` ("annotation
   * name") entry. `/NM` is a PDF-standard string intended to distinguish an
   * annotation from the other annotations on the same page; it is not the
   * visible annotation text or the page number. The engine generates one when
   * {@link PdfAnnotationSpec.id} is omitted. Keep the returned value to pass to
   * {@link updateAnnotation} or {@link removeAnnotation}, or to correlate the
   * annotation with another representation. It is preserved when the PDF is
   * encoded and opened again.
   *
   * The physical write is sent to {@link sourceDocument}; the
   * `annotationsChanged` event is emitted from the source document and every
   * open arrangement that places that source page. Duplicate placements share
   * annotation state and all of their page numbers are reported as affected.
   *
   * @param spec - The spec value (PdfAnnotationSpec).
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async addAnnotation(
    spec: PdfAnnotationSpec,
    options: PdfAnnotationMutationOptions = {},
  ): Promise<string> {
    return this.document.addAnnotationForPage(this, spec, options);
  }

  /**
   * Replaces annotation `id` with a fresh annotation built from the complete
   * `spec`, preserving the id. PDFium has no in-place geometry setter.
   *
   * @param id The {@link PdfAnnotationObject.id} returned by
   *   {@link loadAnnotations}, or the id returned by {@link addAnnotation}.
   *   This is normally the annotation dictionary's `/NM` ("annotation name")
   *   value: a PDF-standard string used to distinguish annotations on the
   *   page. Existing PDFs whose annotation has no `/NM` use a page-local
   *   `@<index>` fallback; use
   *   that fallback only with the unchanged result from the most recent
   *   `loadAnnotations()` call because page mutations can change the index.
   *
   * @param spec - The spec value (PdfAnnotationSpec).
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async updateAnnotation(
    id: string,
    spec: PdfAnnotationSpec,
    options: PdfAnnotationMutationOptions = {},
  ): Promise<string> {
    return this.document.updateAnnotationForPage(this, id, spec, options);
  }

  /**
   * Removes the annotation identified by `id`; returns whether it was found.
   *
   * @param id The {@link PdfAnnotationObject.id} returned by
   *   {@link loadAnnotations}, or the id returned by {@link addAnnotation}.
   *   This is normally the annotation dictionary's stable `/NM` ("annotation
   *   name") value, a PDF-standard string used to distinguish annotations on
   *   the page.
   *   For an existing annotation without `/NM`, `loadAnnotations()` returns a
   *   page-local `@<index>` fallback instead. Such a fallback is positional,
   *   so use it before any other annotation is added, removed, or replaced on
   *   this page; otherwise load the annotations again and use the new id.
   *
   * @param options - Options that customize the operation.
   * @returns The resulting Promise.
   *
   */
  async removeAnnotation(id: string, options: PdfAnnotationMutationOptions = {}): Promise<boolean> {
    return this.document.removeAnnotationForPage(this, id, options);
  }

  /** @internal Returns the complete writable Link-annotation list for CRUD. */
  async loadEditableLinkSpecs(): Promise<PdfLinkSpec[]> {
    return (await this.loadLinks({ enableAutoLinkDetection: false }))
      .filter((link): link is PdfLink & { kind: 'annotation'; id: string } =>
        link.kind === 'annotation' && link.id !== null && link.rects.length > 0
      )
      .map((link) => ({
        id: link.id,
        rect: structuredClone(link.rects[0]!),
        target: structuredClone(link.target),
        annotation: link.annotation ? structuredClone(link.annotation) : null,
      }));
  }

  private annotationFromLink(link: PdfLink & { id: string }): PdfAnnotationObject {
    return {
      id: link.id,
      pageNumber: this.pageNumber,
      subtype: 'link',
      linkTarget: structuredClone(link.target),
      rect: structuredClone(link.rects[0]!),
      color: null,
      interiorColor: null,
      borderWidth: 0,
      flags: 0,
      contents: link.annotation?.content ?? null,
      author: link.annotation?.title ?? null,
      actorId: null,
      revision: 0,
      textOrientation: { rotation: 0, behavior: 'page' },
      textColor: null,
      fontSize: null,
      textAlign: 'left',
      textVerticalAlign: 'top',
      fontFace: null,
      appearanceLines: null,
      appearanceRuns: null,
      appearanceImage: null,
      appearancePaths: [],
      appearanceTextStyles: [],
      subject: link.annotation?.subject ?? null,
      modificationDate: link.annotation?.modificationDate ?? null,
      creationDate: link.annotation?.creationDate ?? null,
      geometry: { kind: 'none' },
    };
  }

  /** @internal Converts a wire annotation (raw coords) to the public model (bbox-relative). */
  private annotationFromWorker(a: WorkerAnnotationObject): PdfAnnotationObject {
    return {
      id: a.id,
      pageNumber: this.pageNumber,
      subtype: pdfAnnotationSubtypeFromName(a.subtype),
      linkTarget: null,
      rect: this.rectFromWorker(a.rect),
      color: colorFromWorker(a.color),
      interiorColor: colorFromWorker(a.interiorColor),
      borderWidth: a.borderWidth,
      flags: a.flags,
      contents: a.contents,
      author: a.author,
      actorId: a.actorId,
      revision: a.revision,
      textOrientation: textOrientationFromWorker(a.textOrientation),
      textColor: colorFromWorker(a.textColor),
      fontSize: a.fontSize,
      textAlign: a.textAlign,
      textVerticalAlign: a.textVerticalAlign,
      fontFace: a.fontFace,
      appearanceLines: a.appearanceLines,
      appearanceRuns: a.appearanceRuns,
      appearanceImage: a.appearanceImage,
      appearancePaths: a.appearancePaths.map((path) => ({
        ...path,
        fillColor: colorFromWorker(path.fillColor),
        strokeColor: colorFromWorker(path.strokeColor),
        segments: path.segments.map(([type, x, y, close]) => ({
          // FPDF_PATHSEGMENT_* values: LINETO=0, BEZIERTO=1, MOVETO=2.
          type: type === 2 ? 'move' as const : type === 1 ? 'bezier' as const : 'line' as const,
          point: this.pointFromWorker(x, y),
          close: !!close,
        })),
      })),
      appearanceTextStyles: a.appearanceTextStyles.map((style) => ({
        origin: this.pointFromWorker(style.x, style.y),
        fontSize: style.fontSize,
        fillColor: colorFromWorker(style.fillColor),
      })),
      subject: a.subject,
      modificationDate: a.modificationDate,
      creationDate: a.creationDate,
      geometry: this.annotationGeometryFromWorker(a.geometry),
    };
  }

  /** @internal */
  private annotationGeometryFromWorker(g: WorkerAnnotationGeometry): PdfAnnotationGeometry {
    switch (g.kind) {
      case 'ink':
        return { kind: 'ink', strokes: g.strokes.map((s) => this.pointsFromFlat(s)) };
      case 'markup':
        return { kind: 'markup', quads: g.quads.map((q) => this.quadFromWorker(q)) };
      case 'line':
        return {
          kind: 'line',
          start: this.pointFromWorker(g.line[0], g.line[1]),
          end: this.pointFromWorker(g.line[2], g.line[3]),
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
   *
   */
  annotationSpecToWorker(spec: PdfAnnotationSpec): WorkerAnnotationSpec {
    return {
      id: spec.id,
      subtype: spec.subtype,
      rect: spec.rect ? this.rectToWorker(spec.rect) : undefined,
      color: spec.color === undefined ? undefined : spec.color === null ? null : colorToWorker(spec.color),
      interiorColor:
        spec.interiorColor === undefined ? undefined : spec.interiorColor === null ? null : colorToWorker(spec.interiorColor),
      borderWidth: spec.borderWidth,
      flags: spec.flags,
      contents: spec.contents,
      author: spec.author,
      actorId: spec.actorId,
      revision: spec.revision,
      textOrientation: spec.textOrientation,
      textColor:
        spec.textColor === undefined ? undefined : spec.textColor === null ? null : colorToWorker(spec.textColor),
      fontSize: spec.fontSize,
      textAlign: spec.textAlign,
      textVerticalAlign: spec.textVerticalAlign,
      fontFace: spec.fontFace,
      appearanceLines: spec.appearanceLines,
      appearanceRuns: spec.appearanceRuns,
      appearanceImage: spec.appearanceImage,
      appearancePaths: spec.appearancePaths?.map((path) => ({
        ...path,
        fillColor: path.fillColor === null ? null : colorToWorker(path.fillColor),
        strokeColor: path.strokeColor === null ? null : colorToWorker(path.strokeColor),
        segments: path.segments.map((segment) => [
          segment.type === 'move' ? 2 : segment.type === 'bezier' ? 1 : 0,
          segment.point.x,
          segment.point.y,
          segment.close ? 1 : 0,
        ]),
      })),
      geometry: spec.geometry ? this.annotationGeometryToWorker(spec.geometry) : undefined,
    };
  }

  /** @internal */
  private annotationGeometryToWorker(g: PdfAnnotationGeometry): WorkerAnnotationGeometry {
    switch (g.kind) {
      case 'ink':
        return { kind: 'ink', strokes: g.strokes.map((s) => this.flatFromPoints(s)) };
      case 'markup':
        return { kind: 'markup', quads: g.quads.map((q) => this.quadToWorker(q)) };
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
  private pointFromWorker(x: number, y: number): PdfAnnotationPoint {
    return { x: x - this.bbLeft, y: y - this.bbBottom };
  }

  /** @internal */
  private pointsFromFlat(flat: number[]): PdfAnnotationPoint[] {
    const pts: PdfAnnotationPoint[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push(this.pointFromWorker(flat[i]!, flat[i + 1]!));
    return pts;
  }

  /** @internal */
  private quadFromWorker(q: number[]): PdfAnnotationQuad {
    return {
      topLeft: this.pointFromWorker(q[0]!, q[1]!),
      topRight: this.pointFromWorker(q[2]!, q[3]!),
      bottomLeft: this.pointFromWorker(q[4]!, q[5]!),
      bottomRight: this.pointFromWorker(q[6]!, q[7]!),
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
  private quadToWorker(q: PdfAnnotationQuad): number[] {
    return [
      ...this.toRawPagePoint(q.topLeft.x, q.topLeft.y),
      ...this.toRawPagePoint(q.topRight.x, q.topRight.y),
      ...this.toRawPagePoint(q.bottomLeft.x, q.bottomLeft.y),
      ...this.toRawPagePoint(q.bottomRight.x, q.bottomRight.y),
    ];
  }

  /** @internal Converts a bbox-relative {@link PdfRect} to a raw wire rect. */
  private rectToWorker(r: PdfRect): WorkerRect {
    return [r.left + this.bbLeft, r.top + this.bbBottom, r.right + this.bbLeft, r.bottom + this.bbBottom];
  }

  /**
   * Converts a wire rect (raw page coordinates) to a {@link PdfRect} relative to
   * the page's bounding-box origin ({@link bbLeft} / {@link bbBottom}).
   * @internal
   *
   */
  private rectFromWorker(r: WorkerRect): PdfRect {
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
   *
   */
  WorkerRectToPdf(r: WorkerRect): PdfRect {
    return this.rectFromWorker(r);
  }

  /**
   * Reserved for internal use only. Converts a bounding-box-relative page point
   * (as used by {@link PdfFormField.rects} / {@link loadLinks}) back to raw PDF
   * page coordinates, which the form-fill `FORM_On*` input APIs expect.
   * @internal
   *
   */
  toRawPagePoint(x: number, y: number): [number, number] {
    return [x + this.bbLeft, y + this.bbBottom];
  }
}

/** @internal */
function colorFromWorker(c: WorkerColor | null): PdfAnnotationColor | null {
  return c ? { r: c[0], g: c[1], b: c[2], a: c[3] } : null;
}

/** @internal */
function colorToWorker(c: PdfAnnotationColor): WorkerColor {
  return [c.r, c.g, c.b, c.a];
}

/**
 * Groups per-widget wire fields into public {@link PdfFormField}s keyed by
 * fully-qualified name (radio-group buttons and other same-named widgets merge),
 * converting rects to the page's bounding-box-relative coordinates.
 * @internal
 *
 */
function groupWorkerFormFields(WorkerFields: WorkerFormField[], page: PdfPage): PdfFormField[] {
  const byName = new Map<string, WorkerFormField[]>();
  const order: string[] = [];
  WorkerFields.forEach((field, index) => {
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
 *
 */
function buildFormField(group: WorkerFormField[], page: PdfPage): PdfFormField {
  const first = group[0]!;
  const type = pdfFormFieldTypeFromCode(first.fieldType);
  const rects = group.map((w) => page.WorkerRectToPdf(w.rect));
  const flags = decodeFormFieldFlags(first.flags);
  const base: PdfFormField = {
    name: first.name,
    type,
    pageNumber: page.pageNumber,
    rects,
    textOrientations: group.map((widget) => textOrientationFromWorker(widget.textOrientation)),
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

/** Normalizes optional persisted text-orientation metadata from older PDFs. */
function textOrientationFromWorker(
  value: { rotation: number; behavior: 'page' | 'upright' } | undefined,
): PdfTextOrientation {
  const rotation = value?.rotation === 90 || value?.rotation === 180 || value?.rotation === 270 ? value.rotation : 0;
  return { rotation, behavior: value?.behavior === 'upright' ? 'upright' : 'page' };
}

/**
 * Converts a wire destination (0-based *physical* page index) to a public
 * ID-based {@link PdfDest} for the corresponding logical page placement.
 * Returns `null` if the destination is absent or its physical page is not in
 * the arrangement (e.g. it was removed by {@link PdfDocument.setPages}).
 *
 */
function pdfDestFromWorker(dest: WorkerDest | null | undefined, doc: PdfDocument): PdfDest | null {
  if (!dest) return null;
  const pageNumber = doc.pageNumberOfSourceIndex(dest.pageIndex);
  if (pageNumber === null) return null;
  return doc.pages[pageNumber - 1]!.dest({ by: 'id', command: dest.command, params: dest.params });
}

type RawPdfDictionary = Extract<PdfRawObject, { kind: 'dictionary' }>;

const rawName = (value: string): PdfRawObject => ({ kind: 'name', value });
const rawInteger = (value: number): PdfRawObject => ({ kind: 'integer', value });
const rawNumber = (value: number): PdfRawObject => ({ kind: 'number', value });
const rawReference = (objectNumber: number): PdfRawObject => ({
  kind: 'reference',
  objectNumber,
  generationNumber: 0,
});
const rawText = (value: string): PdfRawObject => {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    bytes[2 + index * 2] = code >> 8;
    bytes[3 + index * 2] = code & 0xff;
  }
  return { kind: 'string', value: bytes };
};
const rawByteString = (value: string): PdfRawObject => ({
  kind: 'string',
  value: new TextEncoder().encode(value),
});

function decodeRawText(value: PdfRawObject | undefined): string | null {
  if (!value || (value.kind !== 'string' && value.kind !== 'name')) return null;
  if (value.kind === 'name') return value.value;
  const bytes = value.value;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = '';
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      result += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
    }
    return result;
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

function validateDestination(dest: PdfDest | null): void {
  if (!dest) return;
  if (dest.by === 'pageNumber' && (!Number.isInteger(dest.pageNumber) || dest.pageNumber < 1)) {
    throw new RangeError('Destination pageNumber must be a positive integer');
  }
  const command = dest.command.toLowerCase();
  if (!['xyz', 'fit', 'fith', 'fitv', 'fitr', 'fitb', 'fitbh', 'fitbv'].includes(command)) {
    throw new Error(`Unsupported PDF destination command: ${dest.command}`);
  }
  if (dest.params.some((value) => value !== null && !Number.isFinite(value))) {
    throw new RangeError('Destination parameters must be finite numbers or null');
  }
}

function validateOutlineTree(outline: readonly PdfOutlineNode[]): void {
  const active = new Set<PdfOutlineNode>();
  const visit = (nodes: readonly PdfOutlineNode[]): void => {
    for (const node of nodes) {
      if (active.has(node)) throw new Error('Outline must be an acyclic tree');
      validateDestination(node.dest);
      active.add(node);
      visit(node.children);
      active.delete(node);
    }
  };
  visit(outline);
}

function cloneOutline(outline: readonly PdfOutlineNode[]): PdfOutlineNode[] {
  return outline.map((node) => ({
    title: node.title,
    dest: node.dest
      ? { ...node.dest, params: [...node.dest.params] }
      : null,
    children: cloneOutline(node.children),
  }));
}

function validateLinkSpecs(links: readonly PdfLinkSpec[]): void {
  for (const link of links) {
    if (!(link.rect.left < link.rect.right) || !(link.rect.bottom < link.rect.top)) {
      throw new RangeError('Link rectangle must have positive width and height');
    }
    if (link.target.kind === 'uri' && link.target.url.length === 0) {
      throw new Error('Link URI must not be empty');
    }
    if (link.target.kind === 'destination') validateDestination(link.target.dest);
  }
}

function cloneLinkSpecs(links: readonly PdfLinkSpec[]): PdfLinkSpec[] {
  return links.map((link) => ({
    id: link.id ?? createPdfLinkId(),
    rect: { ...link.rect },
    target: link.target.kind === 'uri'
      ? { kind: 'uri', url: link.target.url }
      : {
          kind: 'destination',
          dest: { ...link.target.dest, params: [...link.target.dest.params] },
        },
    annotation: link.annotation ? { ...link.annotation } : null,
  }));
}

function pdfLinkFromSpec(link: PdfLinkSpec): PdfLink {
  return {
    kind: 'annotation',
    id: link.id ?? null,
    rects: [{ ...link.rect }],
    target: link.target.kind === 'uri'
      ? { kind: 'uri', url: link.target.url }
      : {
          kind: 'destination',
          dest: { ...link.target.dest, params: [...link.target.dest.params] },
        },
    annotation: link.annotation
      ? { ...link.annotation }
      : null,
  };
}

function pdfDestinationName(command: string): string {
  const names: Record<string, string> = {
    xyz: 'XYZ', fit: 'Fit', fitb: 'FitB', fith: 'FitH', fitbh: 'FitBH',
    fitv: 'FitV', fitbv: 'FitBV', fitr: 'FitR',
  };
  return names[command.toLowerCase()]!;
}

function outlineDescendantCount(
  parent: number,
  flat: readonly { children: readonly number[] }[],
): number {
  return flat[parent]!.children.reduce(
    (count, child) => count + 1 + outlineDescendantCount(child, flat),
    0,
  );
}

async function loadRawPageReferences(document: PdfDocument): Promise<number[]> {
  const catalog = await document.getCatalogObject();
  if (!catalog.object || catalog.object.kind !== 'dictionary') {
    throw new Error('PDF catalog is not a dictionary');
  }
  const pages = catalog.object.entries.Pages;
  if (!pages || pages.kind !== 'reference') throw new Error('PDF catalog has no indirect /Pages tree');
  const references: number[] = [];
  const visit = async (objectNumber: number): Promise<void> => {
    const result = await document.getRawObject(objectNumber);
    if (!result.object || result.object.kind !== 'dictionary') {
      throw new Error(`PDF page-tree object ${objectNumber} is not a dictionary`);
    }
    const node: RawPdfDictionary = result.object;
    if (node.entries.Type?.kind === 'name' && node.entries.Type.value === 'Page') {
      references.push(objectNumber);
      return;
    }
    const kids = node.entries.Kids;
    if (!kids || kids.kind !== 'array') return;
    for (const kid of kids.items) if (kid.kind === 'reference') await visit(kid.objectNumber);
  };
  await visit(pages.objectNumber);
  return references;
}

async function readRawDictionary(document: PdfDocument, objectNumber: number): Promise<RawPdfDictionary> {
  const result = await document.getRawObject(objectNumber);
  if (!result.object || result.object.kind !== 'dictionary') {
    throw new Error(`PDF object ${objectNumber} is not a dictionary`);
  }
  return result.object;
}

async function resolveRawDictionary(
  document: PdfDocument,
  value: PdfRawObject,
): Promise<RawPdfDictionary | null> {
  if (value.kind === 'dictionary') return value;
  if (value.kind !== 'reference') return null;
  return readRawDictionary(document, value.objectNumber);
}

async function readRawArrayEntry(
  document: PdfDocument,
  value: PdfRawObject | undefined,
): Promise<PdfRawObject[]> {
  if (!value) return [];
  if (value.kind === 'array') return value.items;
  if (value.kind !== 'reference') return [];
  const result = await document.getRawObject(value.objectNumber);
  return result.object?.kind === 'array' ? result.object.items : [];
}
