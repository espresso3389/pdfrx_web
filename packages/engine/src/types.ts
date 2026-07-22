/**
 * Public model types of the engine API.
 *
 * PDF page coordinates are in points
 * (1/72 inch), origin at the bottom-left corner, y-axis pointing up.
 * Rects are `{left, top, right, bottom}` with `top >= bottom`.
 */

/**
 * An axis-aligned rectangle in PDF page coordinates (points, y-up), where
 * `top >= bottom` and `right >= left`.
 *
 * See {@link PdfRect} (the companion namespace-like value) for helpers that
 * operate on these rects.
 */
export interface PdfRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Helper functions for {@link PdfRect} values (the coordinate system is y-up). */
export const PdfRect = {
  /** Width of the rect (`right - left`). */
  width: (r: PdfRect): number => r.right - r.left,
  /** Height of the rect (`top - bottom`, since the y-axis points up). */
  height: (r: PdfRect): number => r.top - r.bottom,
  /** True if the rect has non-positive width or height. */
  isEmpty: (r: PdfRect): boolean => r.right <= r.left || r.top <= r.bottom,
  /** True if `(x, y)` (page coordinates) lies within the rect, edges inclusive. */
  containsPoint: (r: PdfRect, x: number, y: number): boolean =>
    x >= r.left && x <= r.right && y >= r.bottom && y <= r.top,
} as const;

/** Page rotation in clockwise 90-degree steps. */
export type PdfPageRotation = 0 | 90 | 180 | 270;

/**
 * Converts a rotation index (0-3) to a {@link PdfPageRotation}.
 * The index is masked to 0-3, so out-of-range values wrap around.
 */
export const pdfPageRotationFromIndex = (index: number): PdfPageRotation =>
  ((index & 3) * 90) as PdfPageRotation;

/** Inverse of {@link pdfPageRotationFromIndex}: converts a rotation to an index (0-3). */
export const pdfPageRotationToIndex = (rotation: PdfPageRotation): number => rotation / 90;

/**
 * Encryption/permission information of a document. Present only for encrypted
 * documents; see {@link PdfDocument.permissions}.
 *
 * The permission flags follow PDF 32000-1:2008, Table 22. The `allows*` helpers
 * mirror the pdfrx semantics exactly, including the same bit masks, so a
 * document evaluates identically here and in upstream pdfrx.
 */
export class PdfPermissions {
  constructor(
    /** Raw permission flags from the PDF security handler. */
    readonly permissions: number,
    /** Revision of the standard security handler that produced `permissions`. */
    readonly securityHandlerRevision: number,
  ) {}

  /** Whether the document allows copying/extracting its contents. */
  get allowsCopying(): boolean {
    return (this.permissions & 4) !== 0;
  }

  /** Whether the document allows document assembly (insert/rotate/delete pages). */
  get allowsDocumentAssembly(): boolean {
    return (this.permissions & 8) !== 0;
  }

  /** Whether the document allows printing its pages. */
  get allowsPrinting(): boolean {
    return (this.permissions & 16) !== 0;
  }

  /** Whether the document allows modifying annotations and form fields. */
  get allowsModifyAnnotations(): boolean {
    return (this.permissions & 32) !== 0;
  }
}

/**
 * A navigation destination inside a document (e.g. the target of an outline
 * entry or a link).
 */
export interface PdfDest {
  /** 1-based page number the destination points to. */
  readonly pageNumber: number;
  /** e.g. 'xyz', 'fit', 'fitb', ... (lower-cased PDF destination command) */
  readonly command: string;
  /** Command parameters (e.g. zoom/position); `null` entries mean "unchanged". */
  readonly params: readonly (number | null)[];
}

/** A node of the document outline (a.k.a. bookmarks). */
export interface PdfOutlineNode {
  /** Human-readable label of the outline entry. */
  readonly title: string;
  /** Destination jumped to when the entry is activated, or `null` if it has none. */
  readonly dest: PdfDest | null;
  /** Nested child entries. */
  readonly children: readonly PdfOutlineNode[];
}

/** Metadata of a link annotation. */
export interface PdfAnnotation {
  readonly title: string | null;
  readonly content: string | null;
  readonly subject: string | null;
  /** Raw PDF date string (e.g. `D:20240131120000+09'00'`), if any. */
  readonly modificationDate: string | null;
  /** Raw PDF date string, if any. */
  readonly creationDate: string | null;
}

/**
 * A link on a page, either an explicit link annotation or (when auto-detection
 * is enabled) a URL found in the page text.
 * See {@link PdfPage.loadLinks}.
 */
export interface PdfLink {
  /** Areas of the link in PDF page coordinates. */
  readonly rects: readonly PdfRect[];
  /** Target URL for a web link, or `null` if the link points to an in-document {@link dest}. */
  readonly url: string | null;
  /** In-document destination, or `null` if the link is a {@link url}. */
  readonly dest: PdfDest | null;
  /** Annotation metadata for the link, if any. */
  readonly annotation: PdfAnnotation | null;
}

/**
 * Kind of an AcroForm field, mapped from PDFium's `FPDF_FORMFIELD_*` codes.
 */
export type PdfFormFieldType =
  | 'unknown'
  | 'pushButton'
  | 'checkBox'
  | 'radioButton'
  | 'comboBox'
  | 'listBox'
  | 'textField'
  | 'signature';

/** Maps a raw `FPDF_FORMFIELD_*` code to a {@link PdfFormFieldType}. */
export const pdfFormFieldTypeFromCode = (code: number): PdfFormFieldType => {
  switch (code) {
    case 1:
      return 'pushButton';
    case 2:
      return 'checkBox';
    case 3:
      return 'radioButton';
    case 4:
      return 'comboBox';
    case 5:
      return 'listBox';
    case 6:
      return 'textField';
    case 7:
      return 'signature';
    default:
      return 'unknown';
  }
};

/** Decoded `FPDF_FORMFLAG_*` bits of a form field. */
export interface PdfFormFieldFlags {
  /** The field cannot be edited by the user. */
  readonly readOnly: boolean;
  /** The field must have a value when the form is submitted. */
  readonly required: boolean;
  /** The field is excluded from form submission/export. */
  readonly noExport: boolean;
}

/** Decodes the raw `FPDF_FORMFLAG_*` bitmask into {@link PdfFormFieldFlags}. */
export const decodeFormFieldFlags = (flags: number): PdfFormFieldFlags => ({
  readOnly: (flags & 1) !== 0,
  required: (flags & 2) !== 0,
  noExport: (flags & 4) !== 0,
});

/** One selectable option of a combo box or list box. */
export interface PdfFormFieldOption {
  readonly label: string;
  readonly selected: boolean;
}

/**
 * An AcroForm field of a document. A field is identified by its fully-qualified
 * {@link name}; widgets that share a name (e.g. the buttons of a radio group)
 * are merged into one field with several {@link rects}. Obtain them via
 * {@link PdfPage.loadFormFields} / {@link PdfDocument.loadFormFields}, read
 * values here, and change them with {@link PdfDocument.setFormFieldValue}.
 */
export interface PdfFormField {
  /** Fully-qualified field name (`/T`); may be empty for unnamed fields. */
  readonly name: string;
  /** Field kind. */
  readonly type: PdfFormFieldType;
  /** 1-based page number the field's widget(s) sit on. */
  readonly pageNumber: number;
  /** Widget rectangles in PDF page coordinates (one per widget). */
  readonly rects: readonly PdfRect[];
  /** Current value (`/V`): the text, the selected export value, or `''` for buttons. */
  readonly value: string;
  /** Alternate name / tooltip (`/TU`), or `null`. */
  readonly alternateName: string | null;
  /** Checkbox/radio: whether the field is currently checked/selected. */
  readonly isChecked?: boolean;
  /** Checkbox/radio: the export ("on") value; for a radio group, the selected one. */
  readonly exportValue?: string | null;
  /** Combo/list: the options and their selection state. */
  readonly options?: readonly PdfFormFieldOption[];
  /** Text fields: whether the field accepts multiple lines (`/Ff` Multiline bit). */
  readonly multiline?: boolean;
  /** Decoded field flags. */
  readonly flags: PdfFormFieldFlags;
}

/**
 * A value accepted by {@link PdfDocument.setFormFieldValue}. Interpretation
 * depends on the field type: `boolean` toggles a checkbox, a `string` sets text
 * / selects a radio export value or a single choice option, and a `string[]`
 * selects options of a (multi-select) list box.
 */
export type PdfFormFieldValue = string | boolean | string[];

/**
 * Raw text of a page: full text plus one rect per UTF-16 code unit.
 * See {@link PdfPage.loadText}.
 */
export interface PdfPageRawText {
  readonly fullText: string;
  /** `charRects.length === fullText.length`; indices correspond 1:1. */
  readonly charRects: readonly PdfRect[];
}

/**
 * A font the engine could not find while loading or rendering a document.
 * Emitted via the {@link PdfDocumentEventMap.missingFonts | missingFonts} event;
 * supply a substitute with {@link PdfrxEngine.addFontData}.
 *
 * @see [Missing-font fallback](https://github.com/espresso3389/pdfrx_web/blob/master/docs/FONT-FALLBACK.md)
 *   — how the default resolver maps these queries to downloadable fonts.
 */
export interface PdfFontQuery {
  /** Requested typeface (family) name. */
  readonly face: string;
  /** Requested weight (e.g. 400 for regular, 700 for bold). */
  readonly weight: number;
  readonly isItalic: boolean;
  /**
   * PDFium charset id of the requested font (the LOGFONT `lfCharSet` value).
   * Compare against the named ids in {@link PdfFontCharset} (e.g.
   * `query.charset === PdfFontCharset.shiftJis`), or turn it into a label with
   * {@link pdfFontCharsetName}. May be any value PDFium reports; the named set
   * covers the ones it commonly emits.
   */
  readonly charset: number;
  /**
   * PDFium pitch-and-family byte of the requested font (the LOGFONT
   * `lfPitchAndFamily` value). This is a **bitfield**, not an enum — test it
   * with {@link isFixedPitch} / {@link isRomanFamily} / {@link isScriptFamily}
   * (or the {@link PdfFontPitchFamily} masks). See {@link PdfFontPitchFamily}
   * for the bit meanings.
   */
  readonly pitchFamily: number;
}

/**
 * Named PDFium font charset ids (LOGFONT `lfCharSet` values), mirroring pdfrx's
 * `PdfFontCharset` enum. Use these to interpret {@link PdfFontQuery.charset}:
 *
 * ```ts
 * if (query.charset === PdfFontCharset.shiftJis) { … } // Japanese
 * ```
 */
export const PdfFontCharset = {
  /** Windows-1252 / Latin-1. */
  ansi: 0,
  /** System default charset. */
  default: 1,
  /** Symbol font charset. */
  symbol: 2,
  /** Japanese (Shift-JIS). */
  shiftJis: 128,
  /** Korean (Hangul). */
  hangul: 129,
  /** Chinese Simplified (GB2312). */
  gb2312: 134,
  /** Chinese Traditional (Big5). */
  chineseBig5: 136,
  greek: 161,
  vietnamese: 163,
  hebrew: 177,
  arabic: 178,
  cyrillic: 204,
  thai: 222,
  easternEuropean: 238,
} as const;

/** One of the named charset ids in {@link PdfFontCharset}. */
export type PdfFontCharsetId = (typeof PdfFontCharset)[keyof typeof PdfFontCharset];

const pdfFontCharsetNames = new Map<number, string>(
  Object.entries(PdfFontCharset).map(([name, id]) => [id, name]),
);

/**
 * Returns the {@link PdfFontCharset} name for a charset id (e.g. `128` →
 * `'shiftJis'`), or `undefined` if the id is not one of the named charsets.
 */
export const pdfFontCharsetName = (charset: number): string | undefined => pdfFontCharsetNames.get(charset);

/**
 * Bit masks for the {@link PdfFontQuery.pitchFamily} bitfield (from the PDFium
 * LOGFONT `lfPitchAndFamily` byte), mirroring pdfrx's `pitchFamily` flags. A
 * value can combine several of these, so test with a bitwise AND (or the
 * {@link isFixedPitch} / {@link isRomanFamily} / {@link isScriptFamily} helpers).
 */
export const PdfFontPitchFamily = {
  /** Fixed-pitch (monospace) font. */
  fixed: 1,
  /** Roman (serif) font family. */
  roman: 16,
  /** Script (handwriting-style) font family. */
  script: 64,
} as const;

/** Whether a {@link PdfFontQuery.pitchFamily} value has the fixed-pitch (monospace) bit set. */
export const isFixedPitch = (pitchFamily: number): boolean => (pitchFamily & PdfFontPitchFamily.fixed) !== 0;

/** Whether a {@link PdfFontQuery.pitchFamily} value has the Roman (serif) family bit set. */
export const isRomanFamily = (pitchFamily: number): boolean => (pitchFamily & PdfFontPitchFamily.roman) !== 0;

/** Whether a {@link PdfFontQuery.pitchFamily} value has the Script family bit set. */
export const isScriptFamily = (pitchFamily: number): boolean => (pitchFamily & PdfFontPitchFamily.script) !== 0;

/**
 * A point in bounding-box-relative PDF page coordinates (points, y-up) — the
 * same space as {@link PdfRect} and {@link PdfFormField} rects.
 */
export interface PdfAnnotationPoint {
  x: number;
  y: number;
}

/** A text-markup quadrilateral (one highlighted run) in page coordinates. */
export interface PdfAnnotationQuad {
  topLeft: PdfAnnotationPoint;
  topRight: PdfAnnotationPoint;
  bottomLeft: PdfAnnotationPoint;
  bottomRight: PdfAnnotationPoint;
}

/** An RGBA color, each channel 0-255. */
export interface PdfAnnotationColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Subtype-specific geometry of an annotation, in bounding-box-relative page
 * coordinates. `none` covers subtypes whose shape is fully described by
 * {@link PdfAnnotationObject.rect} (square, circle, freeText, text, …).
 */
export type PdfAnnotationGeometry =
  | { kind: 'none' }
  | { kind: 'ink'; strokes: PdfAnnotationPoint[][] }
  | { kind: 'markup'; quads: PdfAnnotationQuad[] }
  | { kind: 'line'; start: PdfAnnotationPoint; end: PdfAnnotationPoint }
  | { kind: 'polygon'; vertices: PdfAnnotationPoint[] }
  | { kind: 'polyline'; vertices: PdfAnnotationPoint[] };

/** PDF annotation subtype (`/Subtype`), lowercased; `unknown` for unmapped types. */
export type PdfAnnotationSubtype =
  | 'text'
  | 'freeText'
  | 'line'
  | 'square'
  | 'circle'
  | 'polygon'
  | 'polyline'
  | 'highlight'
  | 'underline'
  | 'squiggly'
  | 'strikeout'
  | 'stamp'
  | 'caret'
  | 'ink'
  | 'unknown';

/** Subtypes surfaced as their own {@link PdfAnnotationSubtype}; others fold to `unknown`. */
const pdfAnnotationSubtypeNames: ReadonlySet<string> = new Set<PdfAnnotationSubtype>([
  'text',
  'freeText',
  'line',
  'square',
  'circle',
  'polygon',
  'polyline',
  'highlight',
  'underline',
  'squiggly',
  'strikeout',
  'stamp',
  'caret',
  'ink',
]);

/**
 * Maps a wire subtype string (lowercased `/Subtype`) to a
 * {@link PdfAnnotationSubtype}, falling back to `unknown` for anything not
 * surfaced (widgets, links, popups, and rarer types).
 */
export const pdfAnnotationSubtypeFromName = (name: string): PdfAnnotationSubtype =>
  (pdfAnnotationSubtypeNames.has(name) ? name : 'unknown') as PdfAnnotationSubtype;

/**
 * Bit masks for {@link PdfAnnotationObject.flags} (`/F`), matching PDFium's
 * `FPDF_ANNOT_FLAG_*`.
 */
export const PdfAnnotationFlag = {
  invisible: 1,
  hidden: 2,
  print: 4,
  noZoom: 8,
  noRotate: 16,
  noView: 32,
  readOnly: 64,
  locked: 128,
  toggleNoView: 256,
  lockedContents: 512,
} as const;

/**
 * A content annotation on a page (not a widget/link/popup), as read by
 * {@link PdfPage.loadAnnotations} / {@link PdfDocument.loadAnnotations}. Rects and
 * geometry are in bounding-box-relative page coordinates (y-up).
 */
export interface PdfAnnotationObject {
  /** Stable id (`/NM` key, or `@<index>` for annotations that lack one). */
  readonly id: string;
  /** 1-based page number the annotation belongs to. */
  readonly pageNumber: number;
  readonly subtype: PdfAnnotationSubtype;
  /** Bounding rectangle in page coordinates. */
  readonly rect: PdfRect;
  /** Stroke/primary color, or null when unset. */
  readonly color: PdfAnnotationColor | null;
  /** Interior (fill) color, or null when unset. */
  readonly interiorColor: PdfAnnotationColor | null;
  /** Border width in points. */
  readonly borderWidth: number;
  /** Raw `FPDF_ANNOT_FLAG_*` bits (see {@link PdfAnnotationFlag}). */
  readonly flags: number;
  /** `/Contents` text (e.g. a note body or free-text content). */
  readonly contents: string | null;
  /** `/T` author/title. */
  readonly author: string | null;
  readonly fontFace: string | null;
  readonly appearanceLines: readonly string[] | null;
  readonly appearanceRuns: readonly (readonly {
    text: string;
    fontFace: string | null;
    x: number;
    image?: { width: number; height: number; scale: number; pixels: Uint8Array };
  }[])[] | null;
  /** Vector paths extracted from the annotation's normal appearance stream. */
  readonly appearancePaths: readonly {
    readonly segments: readonly {
      readonly type: 'move' | 'line' | 'bezier';
      readonly point: PdfAnnotationPoint;
      readonly close: boolean;
    }[];
    readonly fillColor: PdfAnnotationColor | null;
    readonly strokeColor: PdfAnnotationColor | null;
    readonly strokeWidth: number;
    readonly fillMode: number;
    readonly stroke: boolean;
    readonly lineCap: number;
    readonly lineJoin: number;
  }[];
  /** Text placement/style extracted from the normal appearance stream. */
  readonly appearanceTextStyles: readonly {
    readonly origin: PdfAnnotationPoint;
    readonly fontSize: number;
    readonly fillColor: PdfAnnotationColor | null;
  }[];
  /** `/Subj` subject. */
  readonly subject: string | null;
  /** Raw PDF date string (`D:…`), if any. */
  readonly modificationDate: string | null;
  /** Raw PDF date string, if any. */
  readonly creationDate: string | null;
  /** Subtype-specific geometry. */
  readonly geometry: PdfAnnotationGeometry;
}

/** Filters for {@link PdfDocument.loadAnnotations}. */
export interface PdfLoadAnnotationsOptions {
  /** Return only this subtype, or any of these subtypes. Omit to return all annotations. */
  readonly subtype?: PdfAnnotationSubtype | readonly PdfAnnotationSubtype[];
}

/** Options for {@link PdfDocument.loadHighlights}. */
export interface PdfLoadHighlightsOptions {
  /**
   * Extract the page text covered by each highlight's quadpoints. This loads
   * page text in addition to annotations, so it is disabled by default.
   */
  readonly includeText?: boolean;
}

/** A highlight returned by {@link PdfDocument.loadHighlights}. */
export interface PdfHighlightObject extends PdfAnnotationObject {
  readonly subtype: 'highlight';
  /** Highlighted page text, or `null` when text extraction was not requested or unavailable. */
  readonly text: string | null;
}

/**
 * Parameters to create or replace an annotation via
 * {@link PdfDocument.addAnnotation} / {@link PdfDocument.updateAnnotation}.
 *
 * Only these geometries are honored by the engine: `ink` (freehand; also how the
 * viewer realizes line/arrow), `markup` quads (highlight/underline/squiggly/
 * strikeout), and rect-defined `square`/`circle`. `freeText`/`text` use `rect` +
 * `contents`. Coordinates are bounding-box-relative page coordinates (y-up).
 */
export interface PdfAnnotationSpec {
  subtype: PdfAnnotationSubtype;
  rect?: PdfRect;
  color?: PdfAnnotationColor | null;
  interiorColor?: PdfAnnotationColor | null;
  borderWidth?: number;
  flags?: number;
  contents?: string | null;
  author?: string | null;
  /** Font face registered with the engine for a generated FreeText appearance. */
  fontFace?: string | null;
  /** Pre-wrapped lines used by the generated FreeText appearance. */
  appearanceLines?: string[];
  /** Per-line font runs used for mixed-script FreeText. */
  appearanceRuns?: {
    text: string;
    fontFace: string | null;
    x: number;
    image?: { width: number; height: number; scale: number; pixels: Uint8Array };
  }[][];
  geometry?: PdfAnnotationGeometry;
}

/**
 * Whether/how annotations are drawn when rendering a page.
 *
 * - `none` — draw neither annotations nor form widgets.
 * - `annotation` — draw annotations (and static widget appearances).
 * - `annotationAndForms` — draw annotations plus interactive form widgets.
 * - `formsOnly` — draw interactive form widgets but *not* other annotations;
 *   used by the viewer when annotations are shown through the SVG overlay
 *   instead of the canvas.
 */
export type PdfAnnotationRenderingMode = 'none' | 'annotation' | 'annotationAndForms' | 'formsOnly';

/** Maps a {@link PdfAnnotationRenderingMode} to the numeric code used by the worker protocol. */
export const annotationRenderingModeToIndex = (mode: PdfAnnotationRenderingMode): number => {
  switch (mode) {
    case 'none':
      return 0;
    case 'annotation':
      return 1;
    case 'annotationAndForms':
      return 2;
    case 'formsOnly':
      return 3;
  }
};

/**
 * Function called when a document requires a password.
 * Return the password to try, or `null` to give up (aborts opening with a
 * {@link PdfPasswordException}).
 *
 * It is called repeatedly on each failed attempt until it returns `null` or a
 * correct password, so it may prompt the user anew each time.
 */
export type PdfPasswordProvider = () => string | null | Promise<string | null>;

/**
 * Callback invoked while a document is being downloaded (see
 * {@link PdfOpenUrlOptions.progressCallback}). `bytesTotal` is omitted when the
 * total size is unknown (e.g. no `Content-Length`).
 */
export type PdfDownloadProgressCallback = (bytesReceived: number, bytesTotal?: number) => void;

/**
 * Thrown when opening an encrypted document fails due to a missing/wrong
 * password (i.e. the {@link PdfPasswordProvider} returned `null` or ran out of
 * passwords to try).
 */
export class PdfPasswordException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfPasswordException';
  }
}

/**
 * Result of rendering (a part of) a page: RGBA8888 pixels, ready for Canvas 2D
 * and WebGL without any channel conversion.
 *
 * The engine renders in native BGRA order, but the worker swaps channels while
 * copying the bitmap out (effectively free), so {@link pixels} is already
 * RGBA — the only pixel format the web can consume directly. See
 * {@link PdfPage.render}.
 */
export class PdfImage {
  constructor(
    /** Width of the bitmap in pixels. */
    readonly width: number,
    /** Height of the bitmap in pixels. */
    readonly height: number,
    /** RGBA8888, tightly packed, `width * height * 4` bytes. */
    readonly pixels: Uint8Array,
  ) {}

  /**
   * Wraps the RGBA pixels in an `ImageData` for Canvas 2D. Zero-copy: the
   * returned `ImageData` shares this image's pixel buffer, so do not mutate
   * {@link pixels} afterwards if you keep using the `ImageData`.
   */
  toImageData(): ImageData {
    const p = this.pixels;
    const data = new Uint8ClampedArray(p.buffer as ArrayBuffer, p.byteOffset, p.byteLength);
    return new ImageData(data, this.width, this.height);
  }

  /** Creates an `ImageBitmap`, which is cheaper to draw repeatedly than `putImageData`. */
  toImageBitmap(): Promise<ImageBitmap> {
    return createImageBitmap(this.toImageData());
  }
}

/**
 * Payload types of the events emitted by {@link PdfDocument}, keyed by event
 * name. Subscribe with {@link PdfDocument.addEventListener}.
 */
export interface PdfDocumentEventMap {
  /** All pages are loaded (fired immediately for non-progressive loading). */
  loadComplete: Record<string, never>;
  /** Page objects were replaced (progressive load / reload). */
  pageStatusChanged: { pageNumbers: number[] };
  /**
   * The *arrangement* of pages changed — order, rotation, or count — via
   * `PdfDocument.setPages` or `PdfDocument.assemblePages`. Always accompanied by
   * `pageStatusChanged`; listen to this one to invalidate things keyed by page
   * position, which a plain progressive-load update does not disturb.
   */
  pagesRearranged: { pageNumbers: number[] };
  /** The engine reported missing fonts; supply them via `PdfrxEngine.addFontData`. */
  missingFonts: { queries: PdfFontQuery[] };
  /**
   * A form field value changed. `source` is `'user'` for interactive edits in
   * the viewer (relayed from the form-fill module) and `'api'` for
   * {@link PdfDocument.setFormFieldValue}. Reload values with
   * {@link PdfDocument.loadFormFields} when this fires.
   */
  formFieldsChanged: { source: 'user' | 'api'; pageNumbers?: number[] };
  /**
   * Annotations were added, updated or removed. `source` is `'api'` for
   * {@link PdfDocument.addAnnotation} / {@link PdfDocument.updateAnnotation} /
   * {@link PdfDocument.removeAnnotation} and `'user'` for interactive edits in
   * the viewer. `pageNumbers` lists the affected pages when known. Reload with
   * {@link PdfDocument.loadAnnotations} when this fires.
   */
  annotationsChanged: { source: 'user' | 'api'; pageNumbers?: number[] };
}

/** Union of the event names in {@link PdfDocumentEventMap}. */
export type PdfDocumentEventName = keyof PdfDocumentEventMap;
