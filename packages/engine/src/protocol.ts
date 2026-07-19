/**
 * Wire-level types of the pdfium_worker.js postMessage protocol.
 *
 * This mirrors the protocol implemented by pdfrx's `assets/pdfium_worker.js`
 * (the Dart-side counterpart is `pdfrx/lib/src/wasm/pdfrx_wasm.dart`).
 * Keep this file in lock-step with those two; it is the contract shared by
 * the Dart and TypeScript clients.
 */

/** Rectangle on the wire: `[left, top, right, bottom]` in PDF page coordinates (y-up). */
export type WireRect = [number, number, number, number];

/** PDFium `FPDF_ERR_*` codes (worker's `_errorMappings`). */
export const enum PdfiumErrorCode {
  success = 0,
  unknown = 1,
  file = 2,
  format = 3,
  password = 4,
  security = 5,
  page = 6,
  xfaLoad = 7,
  xfaLayout = 8,
}

/** Error-shaped result returned by document open commands. */
export interface WireError {
  /** Numeric {@link PdfiumErrorCode}. */
  errorCode: number;
  /** Symbolic name of {@link errorCode} (e.g. `"password"`), if the worker provided one. */
  errorCodeStr?: string;
  /** Human-readable error description. */
  message: string;
}

/** Type guard: true if `result` is a {@link WireError} rather than a success payload. */
export function isWireError(result: unknown): result is WireError {
  return typeof result === 'object' && result !== null && typeof (result as WireError).errorCode === 'number';
}

/** Font query reported by the worker when pdfium hits a missing font. */
export interface WireFontQuery {
  face: string;
  weight: number;
  italic: boolean;
  charset: number;
  pitchFamily: number;
}

/** Map of missing-font queries keyed by an opaque font-identity string (deduplicates repeats). */
export type WireFontQueries = Record<string, WireFontQuery>;

/** Per-page metadata as reported by the worker. Basis for {@link PdfPage}. */
export interface WirePageInfo {
  /** 0-based page index (converted to 1-based `pageNumber` on the client). */
  pageIndex: number;
  /** Page width in points (1/72 inch). */
  width: number;
  /** Page height in points (1/72 inch). */
  height: number;
  /** 0: none, 1: 90cw, 2: 180, 3: 270cw */
  rotation: number;
  /** False for pages not yet materialized during progressive loading. */
  isLoaded: boolean;
  /** Left of the bounding box; text/link rects on the wire are not yet adjusted by this. */
  bbLeft: number;
  /** Bottom of the bounding box; text/link rects on the wire are not yet adjusted by this. */
  bbBottom: number;
}

/** Document-level handles and metadata returned by the open/create commands. */
export interface WireDocument {
  /** Opaque handle to the pdfium `FPDF_DOCUMENT` (kept on the worker side). */
  docHandle: number;
  /** Raw permission flags, or negative if the document is not encrypted. */
  permissions: number;
  /** Security-handler revision, or negative if the document is not encrypted. */
  securityHandlerRevision: number;
  pages: WirePageInfo[];
  /** Opaque handle to the pdfium form-fill environment. */
  formHandle: number;
  /** Opaque pointer bookkept alongside {@link formHandle}; passed back on close. */
  formInfo: number;
  missingFonts?: WireFontQueries;
}

/** A navigation destination on the wire (0-based page index). Basis for `PdfDest`. */
export interface WireDest {
  /** 0-based page index (converted to 1-based `pageNumber` on the client). */
  pageIndex: number;
  command: string;
  params: (number | null)[];
}

/** An outline (bookmark) node on the wire. Basis for `PdfOutlineNode`. */
export interface WireOutlineNode {
  title: string;
  dest: WireDest | null;
  children: WireOutlineNode[];
}

/** Annotation metadata on the wire. Basis for `PdfAnnotation`. */
export interface WireAnnotation {
  title?: string | null;
  content?: string | null;
  subject?: string | null;
  /** PDF date string (e.g. `D:20240131120000+09'00'`) */
  modificationDate?: string | null;
  /** PDF date string */
  creationDate?: string | null;
}

/** A link on the wire (link annotation or auto-detected URL). Basis for `PdfLink`. */
export interface WireLink {
  /** Clickable areas in PDF page coordinates, not yet adjusted by the bounding box. */
  rects: WireRect[];
  url?: string | null;
  dest?: WireDest | null;
  annotation?: WireAnnotation | null;
}

/**
 * Parameter/result shapes for every worker command, keyed by command name.
 * Used by {@link PdfiumWorkerCommunicator.sendCommand} to type each round-trip.
 */
export interface PdfiumCommandMap {
  /** Loads and initializes `pdfium.wasm`. Must complete before any other command runs. */
  init: {
    params: {
      /** Extra headers used when the worker fetches `pdfium.wasm`. */
      headers?: Record<string, string>;
      /** Whether the wasm fetch includes credentials. */
      withCredentials?: boolean;
    };
    result: Record<string, never>;
  };
  /** Opens a document from a URL; the worker performs the fetch (subject to CORS). */
  loadDocumentFromUrl: {
    params: {
      url: string;
      password?: string | null;
      useProgressiveLoading?: boolean;
      progressCallbackId?: number;
      preferRangeAccess?: boolean;
      headers?: Record<string, string>;
      withCredentials?: boolean;
    };
    result: WireDocument | WireError;
  };
  /** Opens a document from in-memory bytes (the `ArrayBuffer` is transferred to the worker). */
  loadDocumentFromData: {
    params: {
      data: ArrayBuffer;
      password?: string | null;
      useProgressiveLoading?: boolean;
      /** Optional virtual file name used when the data is large enough to be spooled. */
      url?: string;
    };
    result: WireDocument | WireError;
  };
  /** Creates a new empty document. */
  createNewDocument: {
    params: Record<string, never>;
    result: WireDocument | WireError;
  };
  /** Creates a single-page document whose page shows the given JPEG image. */
  createDocumentFromJpegData: {
    params: {
      jpegData: ArrayBuffer;
      /** Page width in points (1/72 inch). */
      width: number;
      /** Page height in points (1/72 inch). */
      height: number;
    };
    result: WireDocument | WireError;
  };
  /** Loads the next chunk of pages during progressive loading, budgeted by `loadUnitDuration`. */
  loadPagesProgressively: {
    params: {
      docHandle: number;
      firstPageIndex: number;
      loadUnitDuration: number;
    };
    result: {
      pages: WirePageInfo[];
      missingFonts?: WireFontQueries;
    };
  };
  /** Re-reads page metadata (e.g. after the document was modified). */
  reloadPages: {
    params: {
      docHandle: number;
      /** 0-based indices to reload; all pages if omitted. */
      pageIndices?: number[];
      currentPagesCount: number;
    };
    result: {
      pages: WirePageInfo[];
      missingFonts?: WireFontQueries;
    };
  };
  /** Closes a document and releases its handles (including the form environment). */
  closeDocument: {
    params: {
      docHandle: number;
      formHandle?: number;
      formInfo?: number;
    };
    result: { message: string };
  };
  /** Loads the document outline (bookmarks) tree. */
  loadOutline: {
    params: { docHandle: number };
    result: { outline: WireOutlineNode[] };
  };
  /** Loads a single page and returns its pdfium page handle. */
  loadPage: {
    params: { docHandle: number; pageIndex: number };
    result: { pageHandle: number };
  };
  /** Closes a page handle previously obtained from {@link PdfiumCommandMap.loadPage | loadPage}. */
  closePage: {
    params: { pageHandle: number };
    result: { message: string };
  };
  /** Renders (a region of) a page to a BGRA8888 bitmap. */
  renderPage: {
    params: {
      docHandle: number;
      pageIndex: number;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      fullWidth?: number;
      fullHeight?: number;
      /** 32-bit ARGB (e.g. 0xffffffff for white). */
      backgroundColor?: number;
      /** Relative rotation 0-3 applied on top of the page's own rotation. */
      rotation?: number;
      /** 0: none, 1: annotations, 2: annotations and forms */
      annotationRenderingMode?: number;
      flags?: number;
      formHandle?: number;
    };
    result: {
      /** BGRA8888, tightly packed, width*height*4 bytes. */
      imageData: ArrayBuffer;
      width: number;
      height: number;
      missingFonts?: WireFontQueries;
    };
  };
  /** Extracts the page's full text plus one bounding rect per UTF-16 code unit. */
  loadText: {
    params: { docHandle: number; pageIndex: number };
    result: {
      fullText: string;
      charRects: WireRect[];
      missingFonts?: WireFontQueries;
    };
  };
  /** Loads link annotations, optionally including auto-detected URL-like text. */
  loadLinks: {
    params: {
      docHandle: number;
      pageIndex: number;
      enableAutoLinkDetection?: boolean;
    };
    result: { links: WireLink[] };
  };
  /** Re-applies registered font data and refreshes affected caches. */
  reloadFonts: {
    params: { dummy: true };
    result: Record<string, never>;
  };
  /** Registers font bytes used to substitute a missing font (see {@link PdfrxEngine.addFontData}). */
  addFontData: {
    params: {
      face: string;
      data: ArrayBuffer;
      resolvedFace?: string;
    };
    result: Record<string, never>;
  };
  /** Discards all font data previously registered via {@link PdfiumCommandMap.addFontData | addFontData}. */
  clearAllFontData: {
    params: { dummy: true };
    result: Record<string, never>;
  };
  /** Reassembles a document's page order/rotation, optionally importing pages from other documents. */
  assemble: {
    params: {
      docHandle: number;
      /** 0-based page indices; negative values refer to entries in importedPages. */
      pageIndices: number[];
      /** Per-slot absolute rotation (0-3) or null to keep. */
      rotations: (number | null)[];
      importedPages?: Record<number, { docHandle: number; pageNumber: number }>;
    };
    result: { modified: boolean };
  };
  /** Serializes the document to PDF bytes. */
  encodePdf: {
    params: {
      docHandle: number;
      /** Append changes as an incremental update instead of a full rewrite. */
      incremental?: boolean;
      /** Strip the document's encryption/security on save. */
      removeSecurity?: boolean;
    };
    result: { data: ArrayBuffer };
  };
}

/** Union of all worker command names (the keys of {@link PdfiumCommandMap}). */
export type PdfiumCommand = keyof PdfiumCommandMap;

/**
 * Messages posted by the worker back to the main thread.
 *
 * Variants tagged with `type` are unsolicited notifications (`ready`, `error`,
 * `callback`); the `id`-tagged variants are the reply to a specific command
 * request. Handled by {@link PdfiumWorkerCommunicator}.
 */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'callback'; callbackId: number; args: unknown[] }
  | { id: number; status: 'success'; result: unknown }
  | { id: number; status: 'error'; error: string; cause?: unknown };
