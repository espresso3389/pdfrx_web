/**
 * Public model types of the engine API.
 *
 * Coordinate convention follows pdfrx: PDF page coordinates in points
 * (1/72 inch), origin at the bottom-left corner, y-axis pointing up.
 * Rects are `{left, top, right, bottom}` with `top >= bottom`.
 */

/**
 * An axis-aligned rectangle in PDF page coordinates (points, y-up), where
 * `top >= bottom` and `right >= left`. Counterpart of `PdfRect` in pdfrx.
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

/** Page rotation in clockwise 90-degree steps. Counterpart of `PdfPageRotation` in pdfrx. */
export type PdfPageRotation = 0 | 90 | 180 | 270;

/**
 * Converts a pdfium rotation index (0-3) to a {@link PdfPageRotation}.
 * The index is masked to 0-3, so out-of-range values wrap around.
 */
export const pdfPageRotationFromIndex = (index: number): PdfPageRotation =>
  ((index & 3) * 90) as PdfPageRotation;

/** Inverse of {@link pdfPageRotationFromIndex}: converts a rotation to a pdfium index (0-3). */
export const pdfPageRotationToIndex = (rotation: PdfPageRotation): number => rotation / 90;

/**
 * Encryption/permission information of a document. Present only for encrypted
 * documents; see {@link PdfDocument.permissions}. Counterpart of `PdfPermissions`
 * in pdfrx.
 */
export interface PdfPermissions {
  /** Raw permission flags from the PDF security handler. */
  readonly permissions: number;
  /** Revision of the standard security handler that produced {@link permissions}. */
  readonly securityHandlerRevision: number;
}

/**
 * A navigation destination inside a document (e.g. the target of an outline
 * entry or a link). Counterpart of `PdfDest` in pdfrx.
 */
export interface PdfDest {
  /** 1-based page number the destination points to. */
  readonly pageNumber: number;
  /** e.g. 'xyz', 'fit', 'fitb', ... (lower-cased PDF destination command) */
  readonly command: string;
  /** Command parameters (e.g. zoom/position); `null` entries mean "unchanged". */
  readonly params: readonly (number | null)[];
}

/** A node of the document outline (a.k.a. bookmarks). Counterpart of `PdfOutlineNode` in pdfrx. */
export interface PdfOutlineNode {
  /** Human-readable label of the outline entry. */
  readonly title: string;
  /** Destination jumped to when the entry is activated, or `null` if it has none. */
  readonly dest: PdfDest | null;
  /** Nested child entries. */
  readonly children: readonly PdfOutlineNode[];
}

/** Metadata of a link annotation. Counterpart of `PdfAnnotation` in pdfrx. */
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
 * is enabled) a URL found in the page text. Counterpart of `PdfLink` in pdfrx.
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
 * Counterpart of `PdfPageRawText` in pdfrx. See {@link PdfPage.loadText}.
 */
export interface PdfPageRawText {
  readonly fullText: string;
  /** `charRects.length === fullText.length`; indices correspond 1:1. */
  readonly charRects: readonly PdfRect[];
}

/**
 * A font that pdfium could not find while loading or rendering a document.
 * Emitted via the {@link PdfDocumentEventMap.missingFonts | missingFonts} event;
 * supply a substitute with {@link PdfrxEngine.addFontData}. Counterpart of
 * `PdfFontQuery` in pdfrx.
 */
export interface PdfFontQuery {
  /** Requested typeface (family) name. */
  readonly face: string;
  /** Requested weight (e.g. 400 for regular, 700 for bold). */
  readonly weight: number;
  readonly isItalic: boolean;
  /** pdfium/Windows charset id of the requested font. */
  readonly charset: number;
  /** pdfium/Windows pitch-and-family byte of the requested font. */
  readonly pitchFamily: number;
}

/**
 * Whether/how annotations are drawn when rendering a page.
 * Counterpart of `PdfAnnotationRenderingMode` in pdfrx.
 */
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
 * correct password, so it may prompt the user anew each time. Counterpart of
 * `PdfPasswordProvider` in pdfrx.
 */
export type PdfPasswordProvider = () => string | null | Promise<string | null>;

/**
 * Callback invoked while a document is being downloaded (see
 * {@link PdfOpenUrlOptions.progressCallback}). `bytesTotal` is omitted when the
 * total size is unknown (e.g. no `Content-Length`). Counterpart of
 * `PdfDownloadProgressCallback` in pdfrx.
 */
export type PdfDownloadProgressCallback = (bytesReceived: number, bytesTotal?: number) => void;

/**
 * Thrown when opening an encrypted document fails due to a missing/wrong
 * password (i.e. the {@link PdfPasswordProvider} returned `null` or ran out of
 * passwords to try). Counterpart of `PdfPasswordException` in pdfrx.
 */
export class PdfPasswordException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfPasswordException';
  }
}

/**
 * Result of rendering (a part of) a page: BGRA8888 pixels.
 *
 * The worker returns pixels in pdfium's native BGRA order; use
 * {@link toImageData} / {@link toImageBitmap} to obtain Canvas-ready
 * (RGBA-ordered) images. Counterpart of `PdfImage` in pdfrx. See
 * {@link PdfPage.render}.
 */
export class PdfImage {
  constructor(
    /** Width of the bitmap in pixels. */
    readonly width: number,
    /** Height of the bitmap in pixels. */
    readonly height: number,
    /** BGRA8888, tightly packed, `width * height * 4` bytes. */
    readonly pixels: Uint8Array,
  ) {}

  /** Converts BGRA to RGBA and wraps the result in an `ImageData` for Canvas 2D. */
  toImageData(): ImageData {
    const src = this.pixels;
    const dest = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      dest[i] = src[i + 2]!;
      dest[i + 1] = src[i + 1]!;
      dest[i + 2] = src[i]!;
      dest[i + 3] = src[i + 3]!;
    }
    return new ImageData(dest, this.width, this.height);
  }

  /** Creates an `ImageBitmap`, which is cheaper to draw repeatedly than `putImageData`. */
  toImageBitmap(): Promise<ImageBitmap> {
    return createImageBitmap(this.toImageData());
  }
}

/**
 * Payload types of the events emitted by {@link PdfDocument}, keyed by event
 * name. Subscribe with {@link PdfDocument.addEventListener}. Counterpart of the
 * `PdfDocumentEvent` hierarchy in pdfrx.
 */
export interface PdfDocumentEventMap {
  /** All pages are loaded (fired immediately for non-progressive loading). */
  loadComplete: Record<string, never>;
  /** Page objects were replaced (progressive load / reload). */
  pageStatusChanged: { pageNumbers: number[] };
  /** pdfium reported missing fonts; supply them via `PdfrxEngine.addFontData`. */
  missingFonts: { queries: PdfFontQuery[] };
}

/** Union of the event names in {@link PdfDocumentEventMap}. */
export type PdfDocumentEventName = keyof PdfDocumentEventMap;
