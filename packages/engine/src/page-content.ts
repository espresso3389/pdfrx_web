import type { PdfPixelFormat, WorkerPageContentSpec } from './protocol.js';
import type { PdfAnnotationColor } from './types.js';

/**
 * RGBA color whose channels are integers from 0 through 255.
 *
 * Alpha is combined with an object's {@link PdfPathContent.opacity | opacity}
 * where applicable. `{ r: 0, g: 0, b: 0, a: 255 }` is opaque black.
 */
export type PdfColor = PdfAnnotationColor;

/**
 * PDF affine matrix `[a, b, c, d, e, f]`, equivalent to:
 *
 * ```text
 * x' = a*x + c*y + e
 * y' = b*x + d*y + f
 * ```
 *
 * For an image, `[width, 0, 0, height, x, y]` places its unit square in an
 * axis-aligned page rectangle. Matrices and coordinates use PDF's y-up space.
 */
export type PdfMatrix = readonly [number, number, number, number, number, number];

/** One command in a PDF vector path. A subpath normally starts with `moveTo`. */
export type PdfPathSegment =
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'cubicTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'close' };

/**
 * A filled and/or stroked vector path in PDF page coordinates.
 *
 * At least one of {@link fill} and {@link stroke} should be non-null. Path
 * coordinates are transformed by {@link transform} after the path is built.
 */
export interface PdfPathContent {
  /** Discriminant for a vector-path object. */
  kind: 'path';
  /** Ordered path commands. An empty array is rejected. */
  segments: PdfPathSegment[];
  /** Fill color. Omit or use `null` for no fill. */
  fill?: PdfColor | null;
  /** Stroke color. Omit or use `null` for no stroke. */
  stroke?: PdfColor | null;
  /** Stroke width in page points. Default `1`. */
  strokeWidth?: number;
  /** Interior winding rule. Default `'nonzero'`. */
  fillRule?: 'nonzero' | 'evenodd';
  /** Stroke end-cap style. Default `'butt'`. */
  lineCap?: 'butt' | 'round' | 'square';
  /** Stroke corner-join style. Default `'miter'`. */
  lineJoin?: 'miter' | 'round' | 'bevel';
  /** Additional opacity multiplied into fill and stroke alpha. Range 0 through 1; default `1`. */
  opacity?: number;
  /** Optional PDF affine transform applied to the complete path. */
  transform?: PdfMatrix;
}

/**
 * One positioned text run. `x` and `y` locate the text baseline, not the top of
 * its bounding box. A registered `fontFace` is embedded in the PDF.
 */
export interface PdfTextRun {
  /** Unicode text to write. Empty strings produce no page object. */
  text: string;
  /** Face previously registered with `PdfrxEngine.addFontData()`, or `null` for Helvetica. */
  fontFace: string | null;
  /** Baseline x coordinate in page points. */
  x: number;
  /** Baseline y coordinate in page points. */
  y: number;
  /** Font size in page points; must be greater than zero. */
  fontSize: number;
  /** Glyph fill. Defaults to opaque black; `null` disables the fill. */
  fill?: PdfColor | null;
  /** Glyph outline. Omit or use `null` for no outline. */
  stroke?: PdfColor | null;
  /** Glyph outline width in page points. Default `1`. */
  strokeWidth?: number;
  /** Transform applied before the baseline translation `(x, y)`. */
  transform?: PdfMatrix;
}

/**
 * A rasterized color emoji or other inline RGBA glyph image.
 *
 * `width` and `height` are the placed size in page points. `pixelWidth` and
 * `pixelHeight` describe the tightly packed pixel buffer; they default to the
 * placed dimensions for 1:1 caller-produced images. The buffer is transferred.
 */
export interface PdfEmojiRun {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pixel width of {@link pixels}. Defaults to {@link width}. */
  pixelWidth?: number;
  /** Pixel height of {@link pixels}. Defaults to {@link height}. */
  pixelHeight?: number;
  pixels: Uint8Array;
}

/** A group of text runs and optional rasterized emoji embedded as page content. */
export interface PdfTextContent {
  /** Discriminant for a text object group. */
  kind: 'text';
  /** Independently positioned text runs, emitted in order. */
  runs: PdfTextRun[];
  /** RGBA images used for glyphs that cannot be represented by an embedded PDF font. */
  emojiRuns?: PdfEmojiRun[];
}

/** Encoded JPEG bytes or tightly packed decoded pixels used by {@link PdfImageContent}. */
export type PdfPageImageSource =
  | { kind: 'jpeg'; data: ArrayBuffer }
  | {
      kind: 'pixels';
      pixels: ArrayBuffer;
      pixelWidth: number;
      pixelHeight: number;
      format: PdfPixelFormat;
    };

/**
 * An image placed by a PDF affine matrix. Binary source buffers are transferred
 * to the worker and become detached from the caller.
 */
export interface PdfImageContent {
  /** Discriminant for an image object. */
  kind: 'image';
  /** JPEG bytes or decoded pixels. JPEG avoids caller-side decoding. */
  source: PdfPageImageSource;
  /** Maps the image's unit square into PDF page space. */
  transform: PdfMatrix;
  /** Range 0 through 1. Non-opaque values currently require a `pixels` source. */
  opacity?: number;
}

/** One paintable object in a page's content stream. */
export type PdfPageContentObject = PdfPathContent | PdfTextContent | PdfImageContent;

/**
 * One page to create. Dimensions and object coordinates are PDF points
 * (1/72 inch), with a bottom-left origin and a y-axis pointing up.
 *
 * Objects are painted in array order: a later object appears over an earlier
 * object where they overlap.
 */
export interface PdfPageContentSpec {
  /** Page width in points; must be finite and greater than zero. */
  width: number;
  /** Page height in points; must be finite and greater than zero. */
  height: number;
  /** Back-to-front page objects. An empty array creates a blank page. */
  objects: PdfPageContentObject[];
}

/** Options for {@link PdfrxEngine.createFromPageContents}. */
export interface PdfCreateFromPageContentsOptions {
  /** Identifier used in errors and caches. Default `'page-contents'`. */
  sourceName?: string;
}

const finite = (value: number): boolean => Number.isFinite(value);
const validMatrix = (matrix: PdfMatrix | undefined): boolean =>
  matrix === undefined || matrix.every(finite);
const validColor = (color: PdfColor | null | undefined): boolean => color == null ||
  [color.r, color.g, color.b, color.a].every((channel) =>
    Number.isInteger(channel) && channel >= 0 && channel <= 255,
  );

/** @internal */
export function preparePageContents(pages: readonly PdfPageContentSpec[]): {
  pages: WorkerPageContentSpec[];
  transfer: Transferable[];
} {
  if (pages.length === 0) throw new Error('createFromPageContents requires at least one page');
  const buffers = new Set<ArrayBuffer>();
  pages.forEach((page, pageIndex) => {
    if (!finite(page.width) || page.width <= 0 || !finite(page.height) || page.height <= 0) {
      throw new Error(`Page ${pageIndex} has an invalid size`);
    }
    page.objects.forEach((object, objectIndex) => {
      if (object.kind === 'path' && object.segments.length === 0) {
        throw new Error(`Page ${pageIndex} object ${objectIndex} has an empty path`);
      }
      if ('transform' in object && !validMatrix(object.transform)) {
        throw new Error(`Page ${pageIndex} object ${objectIndex} has an invalid matrix`);
      }
      if ('opacity' in object && object.opacity !== undefined &&
          (!finite(object.opacity) || object.opacity < 0 || object.opacity > 1)) {
        throw new Error(`Page ${pageIndex} object ${objectIndex} has an invalid opacity`);
      }
      if (object.kind === 'image') {
        if (object.source.kind === 'jpeg') {
          if (object.opacity !== undefined && object.opacity !== 1) {
            throw new Error('JPEG page-content images currently support only opacity 1');
          }
          buffers.add(object.source.data);
        } else {
          const { pixels, pixelWidth, pixelHeight } = object.source;
          if (!Number.isInteger(pixelWidth) || pixelWidth <= 0 || !Number.isInteger(pixelHeight) || pixelHeight <= 0) {
            throw new Error(`Page ${pageIndex} object ${objectIndex} has invalid pixel dimensions`);
          }
          if (pixels.byteLength < pixelWidth * pixelHeight * 4) {
            throw new Error(`Page ${pageIndex} object ${objectIndex} has too few pixel bytes`);
          }
          buffers.add(pixels);
        }
      } else if (object.kind === 'text') {
        for (const [runIndex, run] of object.runs.entries()) {
          if (!finite(run.x) || !finite(run.y) || !finite(run.fontSize) || run.fontSize <= 0 ||
              !validMatrix(run.transform) || !validColor(run.fill) || !validColor(run.stroke)) {
            throw new Error(`Page ${pageIndex} text run ${runIndex} is invalid`);
          }
        }
        for (const [emojiIndex, emoji] of (object.emojiRuns ?? []).entries()) {
          const pixelWidth = emoji.pixelWidth ?? emoji.width;
          const pixelHeight = emoji.pixelHeight ?? emoji.height;
          if (!finite(emoji.width) || emoji.width <= 0 || !finite(emoji.height) || emoji.height <= 0 ||
              !Number.isInteger(pixelWidth) || pixelWidth <= 0 ||
              !Number.isInteger(pixelHeight) || pixelHeight <= 0 ||
              emoji.pixels.byteLength < pixelWidth * pixelHeight * 4) {
            throw new Error(`Page ${pageIndex} emoji run ${emojiIndex} is invalid`);
          }
          const buffer = emoji.pixels.buffer;
          if (!(buffer instanceof ArrayBuffer)) throw new Error('Shared emoji pixel buffers are not transferable');
          buffers.add(buffer);
        }
      } else {
        if (!validColor(object.fill) || !validColor(object.stroke) ||
            (object.strokeWidth !== undefined && (!finite(object.strokeWidth) || object.strokeWidth < 0))) {
          throw new Error(`Page ${pageIndex} path object ${objectIndex} has invalid paint`);
        }
      }
    });
  });
  return {
    pages: [...pages] as unknown as WorkerPageContentSpec[],
    transfer: [...buffers],
  };
}
