/**
 * Public model types of the engine API.
 *
 * Coordinate convention follows pdfrx: PDF page coordinates in points
 * (1/72 inch), origin at the bottom-left corner, y-axis pointing up.
 * Rects are `{left, top, right, bottom}` with `top >= bottom`.
 */

export interface PdfRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const PdfRect = {
  width: (r: PdfRect): number => r.right - r.left,
  height: (r: PdfRect): number => r.top - r.bottom,
  isEmpty: (r: PdfRect): boolean => r.right <= r.left || r.top <= r.bottom,
  containsPoint: (r: PdfRect, x: number, y: number): boolean =>
    x >= r.left && x <= r.right && y >= r.bottom && y <= r.top,
} as const;

/** Page rotation in clockwise 90-degree steps. */
export type PdfPageRotation = 0 | 90 | 180 | 270;

export const pdfPageRotationFromIndex = (index: number): PdfPageRotation =>
  ((index & 3) * 90) as PdfPageRotation;

export const pdfPageRotationToIndex = (rotation: PdfPageRotation): number => rotation / 90;

export interface PdfPermissions {
  /** Raw permission flags from the PDF security handler. */
  readonly permissions: number;
  readonly securityHandlerRevision: number;
}

export interface PdfDest {
  /** 1-based page number. */
  readonly pageNumber: number;
  /** e.g. 'xyz', 'fit', 'fitb', ... (lower-cased PDF destination command) */
  readonly command: string;
  readonly params: readonly (number | null)[];
}

export interface PdfOutlineNode {
  readonly title: string;
  readonly dest: PdfDest | null;
  readonly children: readonly PdfOutlineNode[];
}

export interface PdfAnnotation {
  readonly title: string | null;
  readonly content: string | null;
  readonly subject: string | null;
  /** Raw PDF date string (e.g. `D:20240131120000+09'00'`), if any. */
  readonly modificationDate: string | null;
  /** Raw PDF date string, if any. */
  readonly creationDate: string | null;
}

export interface PdfLink {
  /** Areas of the link in PDF page coordinates. */
  readonly rects: readonly PdfRect[];
  readonly url: string | null;
  readonly dest: PdfDest | null;
  readonly annotation: PdfAnnotation | null;
}

/** Raw text of a page: full text plus one rect per UTF-16 code unit. */
export interface PdfPageRawText {
  readonly fullText: string;
  /** `charRects.length === fullText.length`; indices correspond 1:1. */
  readonly charRects: readonly PdfRect[];
}

export interface PdfFontQuery {
  readonly face: string;
  readonly weight: number;
  readonly isItalic: boolean;
  readonly charset: number;
  readonly pitchFamily: number;
}

export type PdfAnnotationRenderingMode = 'none' | 'annotation' | 'annotationAndForms';

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
 * Return the password to try, or `null` to give up (aborts opening).
 */
export type PdfPasswordProvider = () => string | null | Promise<string | null>;

export type PdfDownloadProgressCallback = (bytesReceived: number, bytesTotal?: number) => void;

/** Thrown when opening an encrypted document fails due to a missing/wrong password. */
export class PdfPasswordException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfPasswordException';
  }
}

/** Result of rendering (a part of) a page: BGRA8888 pixels. */
export class PdfImage {
  constructor(
    readonly width: number,
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

/** Events emitted by `PdfDocument`. */
export interface PdfDocumentEventMap {
  /** All pages are loaded (fired immediately for non-progressive loading). */
  loadComplete: Record<string, never>;
  /** Page objects were replaced (progressive load / reload). */
  pageStatusChanged: { pageNumbers: number[] };
  /** pdfium reported missing fonts; supply them via `PdfrxEngine.addFontData`. */
  missingFonts: { queries: PdfFontQuery[] };
}

export type PdfDocumentEventName = keyof PdfDocumentEventMap;
