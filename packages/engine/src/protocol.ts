/**
 * Worker-level types of the `pdfium_worker.js` postMessage protocol — the
 * contract between {@link WorkerCommunicator} and the rendering worker.
 */

/** Rectangle on the wire: `[left, top, right, bottom]` in PDF page coordinates (y-up). */
/** @internal */
export type WorkerRect = [number, number, number, number];

/** Error codes reported by the worker when opening or reading a document. */
export const enum PdfErrorCode {
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
/** @internal */
export interface WorkerError {
  /** Numeric {@link PdfErrorCode}. */
  errorCode: number;
  /** Symbolic name of {@link errorCode} (e.g. `"password"`), if the worker provided one. */
  errorCodeStr?: string;
  /** Human-readable error description. */
  message: string;
  /** Opaque worker handle present while an in-memory open awaits another password. */
  dataHandle?: number;
}

/** Type guard: true if `result` is a {@link WorkerError} rather than a success payload. */
/** @internal */
export function isWorkerError(result: unknown): result is WorkerError {
  return typeof result === 'object' && result !== null && typeof (result as WorkerError).errorCode === 'number';
}

/** Font query reported by the worker when the engine hits a missing font. */
/** @internal */
export interface WorkerFontQuery {
  face: string;
  weight: number;
  italic: boolean;
  charset: number;
  pitchFamily: number;
}

/** Map of missing-font queries keyed by an opaque font-identity string (deduplicates repeats). */
/** @internal */
export type WorkerFontQueries = Record<string, WorkerFontQuery>;

/** Per-page metadata as reported by the worker. Basis for {@link PdfPage}. */
/** @internal */
export interface WorkerPageInfo {
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
/** @internal */
export interface WorkerDocument {
  /** Opaque handle to the native document (kept on the worker side). */
  docHandle: number;
  /** Raw permission flags, or negative if the document is not encrypted. */
  permissions: number;
  /** Security-handler revision, or negative if the document is not encrypted. */
  securityHandlerRevision: number;
  pages: WorkerPageInfo[];
  /** Opaque handle to the form-fill environment. */
  formHandle: number;
  /** Opaque pointer bookkept alongside {@link formHandle}; passed back on close. */
  formInfo: number;
  missingFonts?: WorkerFontQueries;
}

/** A navigation destination on the wire (0-based page index). Basis for `PdfDest`. */
/** @internal */
export interface WorkerDest {
  /** 0-based page index (converted to 1-based `pageNumber` on the client). */
  pageIndex: number;
  command: string;
  params: (number | null)[];
}

/** An outline (bookmark) node on the wire. Basis for `PdfOutlineNode`. */
/** @internal */
export interface WorkerOutlineNode {
  title: string;
  dest: WorkerDest | null;
  children: WorkerOutlineNode[];
}

/**
 * A non-recursive, structured-clone representation of one PDF object.
 *
 * The represented PDF object kinds are defined by ISO 32000-2:2020, 7.3
 * ("Objects"); streams by 7.3.8; and indirect references by 7.3.10.
 *
 * Indirect references stay `{ kind: 'reference', ... }` instead of expanding
 * their target, so cyclic object graphs are safe to inspect. PDF strings are
 * their original bytes (not decoded JavaScript text), names are decoded strings,
 * dictionary keys omit the leading `/`, and stream `data` contains decoded
 * bytes. `rawData` is present only when explicitly requested.
 */
export type PdfRawObject =
  | { kind: 'null' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'integer'; value: number }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: Uint8Array }
  | { kind: 'name'; value: string }
  | { kind: 'reference'; objectNumber: number; generationNumber: number }
  | { kind: 'array'; items: PdfRawObject[] }
  | { kind: 'dictionary'; entries: Record<string, PdfRawObject> }
  | {
      kind: 'stream';
      entries: Record<string, PdfRawObject>;
      data: Uint8Array;
      rawData?: Uint8Array;
    };

/**
 * Identifies an existing object or nested container for a raw edit.
 *
 * Start with exactly one of:
 *
 * - `root: true` — the document catalog;
 * - `objectNumber` — an existing indirect object; or
 * - `localId` — an indirect dictionary created in the same worker batch.
 *
 * `path`, when present, is followed from that starting object. String
 * components select dictionary keys (without `/`) and number components select
 * zero-based array items. Indirect references encountered along the path are
 * dereferenced automatically. Application code should normally obtain targets
 * from `PdfRawObjectEditor.catalog()`, `object()`, `at()`, or
 * `createDictionary()` rather than constructing this wire shape directly.
 */
export interface PdfRawTarget {
  /** Selects the document catalog. Mutually exclusive with `objectNumber` and `localId`. */
  root?: true;
  /** Selects an existing indirect object by its positive PDF object number. */
  objectNumber?: number;
  /** Selects an indirect dictionary created earlier in the same operation batch. */
  localId?: string;
  /** Dictionary keys and zero-based array indices to traverse from the selected starting object. */
  path?: (string | number)[];
}

/**
 * Value accepted by a raw PDF edit operation.
 *
 * It has the same recursive shapes as {@link PdfRawObject}, plus
 * `localReference`, which points at an indirect dictionary created in the same
 * batch. With {@link PdfRawObjectEditor}, use
 * `PdfRawCreatedObject.reference` instead of constructing a local reference.
 */
export type PdfRawPatchValue =
  | Exclude<PdfRawObject, { kind: 'array' | 'dictionary' | 'stream' }>
  | { kind: 'localReference'; id: string }
  | { kind: 'array'; items: PdfRawPatchValue[] }
  | { kind: 'dictionary'; entries: Record<string, PdfRawPatchValue> }
  | {
      kind: 'stream';
      entries: Record<string, PdfRawPatchValue>;
      data: Uint8Array;
      rawData?: Uint8Array;
    };

/**
 * Low-level worker-protocol operation compiled by `PdfRawObjectEditor`.
 *
 * Normal application code uses the editor's dictionary/array/stream methods.
 * This union is useful to integrations that compile or inspect raw edit batches
 * before applying them.
 */
export type PdfRawPatchOperation =
  | { op: 'dictionarySet'; target: PdfRawTarget; key: string; value: PdfRawPatchValue }
  | { op: 'dictionaryRemove'; target: PdfRawTarget; key: string }
  | { op: 'arrayAppend'; target: PdfRawTarget; value: PdfRawPatchValue }
  | { op: 'arraySet'; target: PdfRawTarget; index: number; value: PdfRawPatchValue }
  | { op: 'arrayRemove'; target: PdfRawTarget; index: number }
  | { op: 'streamSetData'; target: PdfRawTarget; data: Uint8Array };

/** Annotation metadata on the wire. Basis for `PdfAnnotation`. */
/** @internal */
export interface WorkerAnnotation {
  title?: string | null;
  content?: string | null;
  subject?: string | null;
  /** PDF date string (e.g. `D:20240131120000+09'00'`) */
  modificationDate?: string | null;
  /** PDF date string */
  creationDate?: string | null;
}

/** A link on the wire (link annotation or auto-detected URL). Basis for `PdfLink`. */
/** @internal */
export interface WorkerLink {
  /** Stable `/NM` value or page-local `@<annotation-index>` fallback. */
  id?: string | null;
  /** Whether this is a PDF Link annotation or detected page text. */
  kind?: 'annotation' | 'detected';
  /** Clickable areas in PDF page coordinates, not yet adjusted by the bounding box. */
  rects: WorkerRect[];
  url?: string | null;
  dest?: WorkerDest | null;
  annotation?: WorkerAnnotation | null;
}

/** One option of a choice (combo/list) form field on the wire. */
/** @internal */
export interface WorkerFormFieldOption {
  label: string;
  selected: boolean;
}

/** A form field widget on the wire (one per widget annotation). Basis for `PdfFormField`. */
/** @internal */
export interface WorkerFormField {
  /** Fully-qualified field name (`/T` chain); empty when unnamed. */
  name: string;
  /** Raw `FPDF_FORMFIELD_*` type code. */
  fieldType: number;
  /** Raw `FPDF_FORMFLAG_*` bit flags. */
  flags: number;
  /** Widget rectangle in raw page coordinates (not yet bounding-box adjusted). */
  rect: WorkerRect;
  /** Persisted text orientation for this widget. */
  textOrientation?: { rotation: number; behavior: 'page' | 'upright' };
  /** Current field value (`/V`). */
  value: string;
  /** Alternate name / tooltip (`/TU`). */
  alternateName: string;
  /** Checkbox/radio only: whether this widget is the checked state. */
  isChecked?: boolean;
  /** Checkbox/radio only: this widget's export ("on") value. */
  exportValue?: string;
  /** Combo/list only: the selectable options. */
  options?: WorkerFormFieldOption[];
}

/** An RGBA color (0-255 per channel) on the wire. */
/** @internal */
export type WorkerColor = [number, number, number, number];

/**
 * Subtype-specific geometry of an annotation on the wire, in **raw page
 * coordinates** (y-up, not yet bounding-box adjusted). Point lists are flat
 * `[x0, y0, x1, y1, ...]`; quads follow PDFium's `FS_QUADPOINTSF` ordering.
 */
/** @internal */
export type WorkerAnnotationGeometry =
  | { kind: 'none' }
  | { kind: 'ink'; strokes: number[][] }
  | { kind: 'markup'; quads: number[][] }
  | { kind: 'line'; line: [number, number, number, number] }
  | { kind: 'polygon'; vertices: number[] }
  | { kind: 'polyline'; vertices: number[] };

/** A content annotation on the wire (one per non-widget/link/popup annotation). */
/** @internal */
export interface WorkerAnnotationObject {
  /** Stable id from the `/NM` key, or `@<index>` for annotations that lack one. */
  id: string;
  /** Lowercased subtype name (`ink`, `highlight`, `square`, …); `unknown` if unmapped. */
  subtype: string;
  /** Page-local annotation index at read time (not stable across removals). */
  index: number;
  /** Bounding rectangle in raw page coordinates. */
  rect: WorkerRect;
  /** Stroke/primary color, or null when unset. */
  color: WorkerColor | null;
  /** Interior (fill) color, or null when unset. */
  interiorColor: WorkerColor | null;
  /** Border width in points. */
  borderWidth: number;
  /** Raw `FPDF_ANNOT_FLAG_*` bits. */
  flags: number;
  /** `/Contents` text. */
  contents: string | null;
  /** `/T` author/title. */
  author: string | null;
  actorId: string | null;
  revision: number;
  textOrientation?: { rotation: number; behavior: 'page' | 'upright' };
  textColor: WorkerColor | null;
  fontSize: number | null;
  textAlign: 'left' | 'center' | 'right';
  textVerticalAlign: 'top' | 'middle' | 'bottom';
  fontFace: string | null;
  appearanceLines: string[] | null;
  appearanceRuns: {
    text: string;
    fontFace: string | null;
    x: number;
    image?: { width: number; height: number; scale: number; pixels: Uint8Array };
  }[][] | null;
  appearanceImage: { width: number; height: number; pixels: Uint8Array } | null;
  appearancePaths: {
    segments: [number, number, number, number][];
    fillColor: WorkerColor | null;
    strokeColor: WorkerColor | null;
    strokeWidth: number;
    fillMode: number;
    stroke: boolean;
    lineCap: number;
    lineJoin: number;
  }[];
  appearanceTextStyles: {
    x: number;
    y: number;
    fontSize: number;
    fillColor: WorkerColor | null;
  }[];
  /** `/Subj` subject. */
  subject: string | null;
  modificationDate: string | null;
  creationDate: string | null;
  geometry: WorkerAnnotationGeometry;
}

/**
 * Parameters to create (or replace) an annotation, in **raw page coordinates**.
 * Only ink / markup / rect-defined square & circle / freeText / text geometries
 * are honored by the worker (see `_applyAnnotSpec`); other fields apply to all.
 */
/** @internal */
export interface WorkerAnnotationSpec {
  /** Creatable subtype: `ink`, `highlight`, `underline`, `squiggly`, `strikeout`, `square`, `circle`, `freeText`, `text`. */
  subtype: string;
  /** Preserve a specific `/NM` id (used by replace); a fresh id is generated otherwise. */
  id?: string;
  rect?: WorkerRect;
  color?: WorkerColor | null;
  interiorColor?: WorkerColor | null;
  borderWidth?: number;
  flags?: number;
  contents?: string | null;
  author?: string | null;
  actorId?: string | null;
  revision?: number;
  textOrientation?: { rotation: number; behavior: 'page' | 'upright' };
  /** FreeText glyph color. */
  textColor?: WorkerColor | null;
  /** FreeText font size in points. */
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  textVerticalAlign?: 'top' | 'middle' | 'bottom';
  /** Registered worker font face used to build a FreeText appearance. */
  fontFace?: string | null;
  /** Pre-wrapped lines for the generated FreeText appearance. */
  appearanceLines?: string[];
  /** Per-line font runs used for mixed-script FreeText. */
  appearanceRuns?: {
    text: string;
    fontFace: string | null;
    x: number;
    image?: { width: number; height: number; scale: number; pixels: Uint8Array };
  }[][];
  /** RGBA pixels used as the normal appearance of a `stamp` annotation. */
  appearanceImage?: { width: number; height: number; pixels: Uint8Array };
  /** Normalized SVG-style vector paths for a stamp appearance. */
  appearancePaths?: {
    segments: [number, number, number, number][];
    fillColor: WorkerColor | null;
    strokeColor: WorkerColor | null;
    strokeWidth: number;
    fillMode: number;
    stroke: boolean;
    lineCap: number;
    lineJoin: number;
  }[];
  geometry?: WorkerAnnotationGeometry;
}

/** Byte order of raw pixel data handed to the worker. */
export type PdfPixelFormat = 'rgba8888' | 'bgra8888';

/** Page-content wire shape. Kept structural so the public authoring types stay out of the worker protocol. */
/** @internal */
export interface WorkerPageContentSpec {
  width: number;
  height: number;
  objects: Array<Record<string, unknown>>;
}

/**
 * One page of a document built by {@link WorkerCommandMap.createDocumentFromImages}.
 *
 * `width`/`height` are the page dimensions in points (1/72 inch). A `jpeg` page
 * carries the encoded bytes and lets PDFium decode them natively (works on every
 * runtime); a `pixels` page carries already-decoded pixels for formats PDFium
 * cannot read on its own. All `ArrayBuffer`s are transferred to the worker.
 */
/** @internal */
export type WorkerImagePage =
  | { kind: 'jpeg'; data: ArrayBuffer; width: number; height: number }
  | {
      kind: 'pixels';
      pixels: ArrayBuffer;
      /** Pixel width of the bitmap. */
      pixelWidth: number;
      /** Pixel height of the bitmap. */
      pixelHeight: number;
      format: PdfPixelFormat;
      width: number;
      height: number;
    };

/**
 * Parameter/result shapes for every worker command, keyed by command name.
 * Used by {@link WorkerCommunicator.sendCommand} to type each round-trip.
 */
/** @internal */
export interface WorkerCommandMap {
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
    result: WorkerDocument | WorkerError;
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
    result: WorkerDocument | WorkerError;
  };
  /** Retries a password-protected in-memory open; the worker already owns the bytes. */
  retryDocumentFromData: {
    params: {
      dataHandle: number;
      password: string;
    };
    result: WorkerDocument | WorkerError;
  };
  /** Releases bytes retained after an abandoned password-protected in-memory open. */
  cancelDocumentFromData: {
    params: {
      dataHandle: number;
    };
    result: Record<string, never>;
  };
  /** Creates a new empty document. */
  createNewDocument: {
    params: Record<string, never>;
    result: WorkerDocument | WorkerError;
  };
  /** Creates a document whose pages each display one image (one page per {@link WorkerImagePage}). */
  createDocumentFromImages: {
    params: {
      /** One entry per page, in order. */
      pages: WorkerImagePage[];
    };
    result: WorkerDocument | WorkerError;
  };
  /** Creates unplaced pages and all their objects in a live document in one round trip. */
  createPagesFromContents: {
    params: { docHandle: number; pages: WorkerPageContentSpec[] };
    result: { pages: WorkerPageInfo[]; pageCount: number };
  };
  /** Loads the next chunk of pages during progressive loading, budgeted by `loadUnitDuration`. */
  loadPagesProgressively: {
    params: {
      docHandle: number;
      firstPageIndex: number;
      loadUnitDuration: number;
    };
    result: {
      pages: WorkerPageInfo[];
      missingFonts?: WorkerFontQueries;
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
      pages: WorkerPageInfo[];
      missingFonts?: WorkerFontQueries;
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
    result: { outline: WorkerOutlineNode[] };
  };
  /** Loads a single page and returns its native page handle. */
  loadPage: {
    params: { docHandle: number; pageIndex: number };
    result: { pageHandle: number };
  };
  /** Closes a page handle previously obtained from {@link WorkerCommandMap.loadPage | loadPage}. */
  closePage: {
    params: { pageHandle: number };
    result: { message: string };
  };
  /**
   * Renders (a region of) a page to an RGBA8888 bitmap. The engine renders BGRA
   * natively; the vendored worker swaps to RGBA on the way out so the result is
   * Canvas/WebGL-ready.
   */
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
      /** RGBA8888, tightly packed, width*height*4 bytes. */
      imageData: ArrayBuffer;
      width: number;
      height: number;
      missingFonts?: WorkerFontQueries;
    };
  };
  /** Extracts the page's full text plus one bounding rect per UTF-16 code unit. */
  loadText: {
    params: { docHandle: number; pageIndex: number };
    result: {
      fullText: string;
      charRects: WorkerRect[];
      missingFonts?: WorkerFontQueries;
    };
  };
  /** Loads link annotations, optionally including auto-detected URL-like text. */
  loadLinks: {
    params: {
      docHandle: number;
      pageIndex: number;
      enableAutoLinkDetection?: boolean;
    };
    result: { links: WorkerLink[] };
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
  /** Discards all font data previously registered via {@link WorkerCommandMap.addFontData | addFontData}. */
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
  /** Reads the catalog or one indirect PDF object without expanding references. */
  rawGetObject: {
    params: { docHandle: number; objectNumber?: number; includeRawStreamData?: boolean };
    result: { object: PdfRawObject | null; objectNumber: number; generationNumber: number };
  };
  /** Adds indirect dictionaries and applies raw dictionary/array/stream mutations as one worker command. */
  rawApplyPatch: {
    params: {
      docHandle: number;
      createDictionaries?: string[];
      operations: PdfRawPatchOperation[];
    };
    result: { created: Record<string, number> };
  };
  /** Creates an independent native copy of a document without changing it. */
  cloneDocument: {
    params: { docHandle: number };
    result: WorkerDocument | WorkerError;
  };
  /** Enumerates the AcroForm widget fields on one page. */
  loadFormFields: {
    params: { docHandle: number; formHandle: number; pageIndex: number };
    result: { fields: WorkerFormField[] };
  };
  /** Reads every named field's calculate-action (`/AA/C`) JavaScript source. */
  loadFormCalculations: {
    params: { docHandle: number; formHandle: number; pageCount: number };
    result: { calculations: { name: string; js: string }[] };
  };
  /**
   * Sets a form field's value by fully-qualified name, routed through the
   * form-fill module so the widget appearance regenerates and `FFI_OnChange`
   * fires. Which of `value`/`checked`/`selectedLabels` is used depends on the
   * field's actual type.
   */
  setFormFieldValue: {
    params: {
      docHandle: number;
      formHandle: number;
      pageIndex: number;
      fieldName: string;
      /** Text value (text field/editable combo), radio export value, or one choice-option label. */
      value?: string;
      /** Checkbox desired state. */
      checked?: boolean;
      /** Option labels to select (list/combo, including single-select fields). */
      selectedLabels?: string[];
    };
    result: { ok: boolean };
  };
  /** Opens a page for interactive form editing (`FORM_OnAfterLoadPage`); the handle is cached. */
  formOpenPage: {
    params: { docHandle: number; formHandle: number; pageIndex: number };
    result: { pageHandle: number };
  };
  /** Closes an interactive form page (`FORM_OnBeforeClosePage`). */
  formClosePage: {
    params: { docHandle: number; formHandle: number; pageIndex: number };
    result: { message: string };
  };
  /** Forwards a pointer event (PDF page coordinates, y-up) to the form-fill module. */
  formPointerEvent: {
    params: {
      docHandle: number;
      formHandle: number;
      pageIndex: number;
      type: 'down' | 'up' | 'move' | 'doubleClick';
      x: number;
      y: number;
      /** FWL event-flag bitmask (shift/ctrl/alt). Default 0. */
      modifier?: number;
    };
    result: { message: string };
  };
  /** Forwards a keyboard event to the form-fill module. */
  formKeyEvent: {
    params: {
      docHandle: number;
      formHandle: number;
      pageIndex: number;
      /** `char` → `FORM_OnChar` (Unicode); `keyDown`/`keyUp` → FWL virtual key code. */
      type: 'char' | 'keyDown' | 'keyUp';
      code: number;
      /** FWL event-flag bitmask (shift/ctrl/alt). Default 0. */
      modifier?: number;
    };
    result: { message: string };
  };
  /** Clears the form's keyboard focus (`FORM_ForceToKillFocus`). */
  formKillFocus: {
    params: { docHandle: number; formHandle: number };
    result: { message: string };
  };
  /** Registers the callback id used to relay form invalidate/change notifications. */
  registerFormNotify: {
    params: { docHandle: number; callbackId: number };
    result: { message: string };
  };
  /** Enumerates the content annotations (skipping widgets/links/popups) on one page. */
  loadAnnotations: {
    params: { docHandle: number; pageIndex: number };
    result: { annotations: WorkerAnnotationObject[] };
  };
  /**
   * Creates an annotation from `spec`, generates its appearance stream so it
   * persists through `encodePdf`, and returns its `/NM` id.
   */
  addAnnotation: {
    params: { docHandle: number; pageIndex: number; spec: WorkerAnnotationSpec };
    result: { id: string; revision: number };
  };
  /** Replaces the annotation identified by `id` with a fresh one built from `spec` (same id). */
  updateAnnotation: {
    params: {
      docHandle: number;
      pageIndex: number;
      id: string;
      spec: WorkerAnnotationSpec;
      preserveAppearance?: boolean;
    };
    result: { id: string; revision: number };
  };
  /** Removes the annotation identified by `id` (its `/NM` key, or `@<index>`). */
  removeAnnotation: {
    params: { docHandle: number; pageIndex: number; id: string };
    result: { ok: boolean };
  };
}

/**
 * Payload relayed to the client's form-notify callback (registered via
 * `registerFormNotify`). `invalidate` carries a dirty rectangle in PDF page
 * coordinates; `change` signals that some field value changed.
 */
/** @internal */
export type WorkerFormNotification =
  | { kind: 'invalidate'; pageIndex: number; rect: WorkerRect }
  | { kind: 'change' };

/** Union of all worker command names (the keys of {@link WorkerCommandMap}). */
/** @internal */
export type WorkerCommand = keyof WorkerCommandMap;

/**
 * Messages posted by the worker back to the main thread.
 *
 * Variants tagged with `type` are unsolicited notifications (`ready`, `error`,
 * `callback`); the `id`-tagged variants are the reply to a specific command
 * request. Handled by {@link WorkerCommunicator}.
 */
/** @internal */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'callback'; callbackId: number; args: unknown[] }
  | { id: number; status: 'success'; result: unknown }
  | { id: number; status: 'error'; error: string; cause?: unknown };
