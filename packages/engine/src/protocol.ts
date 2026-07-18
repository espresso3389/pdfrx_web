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
  errorCode: number;
  errorCodeStr?: string;
  message: string;
}

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

/** Map keyed by an opaque font-identity string. */
export type WireFontQueries = Record<string, WireFontQuery>;

export interface WirePageInfo {
  pageIndex: number;
  width: number;
  height: number;
  /** 0: none, 1: 90cw, 2: 180, 3: 270cw */
  rotation: number;
  isLoaded: boolean;
  /** Left of the bounding box; text/link rects on the wire are not yet adjusted by this. */
  bbLeft: number;
  /** Bottom of the bounding box; text/link rects on the wire are not yet adjusted by this. */
  bbBottom: number;
}

export interface WireDocument {
  docHandle: number;
  permissions: number;
  securityHandlerRevision: number;
  pages: WirePageInfo[];
  formHandle: number;
  formInfo: number;
  missingFonts?: WireFontQueries;
}

export interface WireDest {
  pageIndex: number;
  command: string;
  params: (number | null)[];
}

export interface WireOutlineNode {
  title: string;
  dest: WireDest | null;
  children: WireOutlineNode[];
}

export interface WireAnnotation {
  title?: string | null;
  content?: string | null;
  subject?: string | null;
  /** PDF date string (e.g. `D:20240131120000+09'00'`) */
  modificationDate?: string | null;
  /** PDF date string */
  creationDate?: string | null;
}

export interface WireLink {
  rects: WireRect[];
  url?: string | null;
  dest?: WireDest | null;
  annotation?: WireAnnotation | null;
}

/** Parameter/result shapes for every worker command. */
export interface PdfiumCommandMap {
  init: {
    params: {
      headers?: Record<string, string>;
      withCredentials?: boolean;
    };
    result: Record<string, never>;
  };
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
  createNewDocument: {
    params: Record<string, never>;
    result: WireDocument | WireError;
  };
  createDocumentFromJpegData: {
    params: {
      jpegData: ArrayBuffer;
      width: number;
      height: number;
    };
    result: WireDocument | WireError;
  };
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
  reloadPages: {
    params: {
      docHandle: number;
      pageIndices?: number[];
      currentPagesCount: number;
    };
    result: {
      pages: WirePageInfo[];
      missingFonts?: WireFontQueries;
    };
  };
  closeDocument: {
    params: {
      docHandle: number;
      formHandle?: number;
      formInfo?: number;
    };
    result: { message: string };
  };
  loadOutline: {
    params: { docHandle: number };
    result: { outline: WireOutlineNode[] };
  };
  loadPage: {
    params: { docHandle: number; pageIndex: number };
    result: { pageHandle: number };
  };
  closePage: {
    params: { pageHandle: number };
    result: { message: string };
  };
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
  loadText: {
    params: { docHandle: number; pageIndex: number };
    result: {
      fullText: string;
      charRects: WireRect[];
      missingFonts?: WireFontQueries;
    };
  };
  loadLinks: {
    params: {
      docHandle: number;
      pageIndex: number;
      enableAutoLinkDetection?: boolean;
    };
    result: { links: WireLink[] };
  };
  reloadFonts: {
    params: { dummy: true };
    result: Record<string, never>;
  };
  addFontData: {
    params: {
      face: string;
      data: ArrayBuffer;
      resolvedFace?: string;
    };
    result: Record<string, never>;
  };
  clearAllFontData: {
    params: { dummy: true };
    result: Record<string, never>;
  };
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
  encodePdf: {
    params: {
      docHandle: number;
      incremental?: boolean;
      removeSecurity?: boolean;
    };
    result: { data: ArrayBuffer };
  };
}

export type PdfiumCommand = keyof PdfiumCommandMap;

/** Messages posted by the worker back to the main thread. */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'callback'; callbackId: number; args: unknown[] }
  | { id: number; status: 'success'; result: unknown }
  | { id: number; status: 'error'; error: string; cause?: unknown };
