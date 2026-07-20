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
    /** Revision of the standard security handler that produced {@link permissions}. */
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

/** Whether/how annotations are drawn when rendering a page. */
export type PdfAnnotationRenderingMode = 'none' | 'annotation' | 'annotationAndForms';

/** Maps a {@link PdfAnnotationRenderingMode} to the numeric code used by the worker protocol. */
export const annotationRenderingModeToIndex = (mode: PdfAnnotationRenderingMode): number => {
  switch (mode) {
    case 'none':
      return 0;
    case 'annotation':
      return 1;
    case 'annotationAndForms':
      return 2;
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
  /** The engine reported missing fonts; supply them via `PdfrxEngine.addFontData`. */
  missingFonts: { queries: PdfFontQuery[] };
}

/** Union of the event names in {@link PdfDocumentEventMap}. */
export type PdfDocumentEventName = keyof PdfDocumentEventMap;
