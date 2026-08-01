import type { PdfPixelFormat, WorkerPageContentSpec } from './protocol.js';
import type { PdfAnnotationColor } from './types.js';

/** RGBA color whose channels are integers from 0 through 255. */
export type PdfColor = PdfAnnotationColor;

/** PDF affine matrix `[a, b, c, d, e, f]`. */
export type PdfMatrix = readonly [number, number, number, number, number, number];

export type PdfPathSegment =
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'cubicTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'close' };

/** A filled and/or stroked vector path in PDF page coordinates. */
export interface PdfPathContent {
  kind: 'path';
  segments: PdfPathSegment[];
  fill?: PdfColor | null;
  stroke?: PdfColor | null;
  strokeWidth?: number;
  fillRule?: 'nonzero' | 'evenodd';
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
  opacity?: number;
  transform?: PdfMatrix;
}

/** One positioned text run. Registered fonts are embedded by face name. */
export interface PdfTextRun {
  text: string;
  fontFace: string | null;
  x: number;
  y: number;
  fontSize: number;
  fill?: PdfColor | null;
  stroke?: PdfColor | null;
  strokeWidth?: number;
  transform?: PdfMatrix;
}

/** A rasterized emoji or other inline glyph image. */
export interface PdfEmojiRun {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Text and optional rasterized emoji embedded as page content. */
export interface PdfTextContent {
  kind: 'text';
  runs: PdfTextRun[];
  emojiRuns?: PdfEmojiRun[];
}

export type PdfPageImageSource =
  | { kind: 'jpeg'; data: ArrayBuffer }
  | {
      kind: 'pixels';
      pixels: ArrayBuffer;
      pixelWidth: number;
      pixelHeight: number;
      format: PdfPixelFormat;
    };

/** An image placed by a PDF affine matrix. */
export interface PdfImageContent {
  kind: 'image';
  source: PdfPageImageSource;
  transform: PdfMatrix;
  opacity?: number;
}

export type PdfPageContentObject = PdfPathContent | PdfTextContent | PdfImageContent;

/** One page to create. Dimensions and object coordinates are PDF points (bottom-left origin, y-up). */
export interface PdfPageContentSpec {
  width: number;
  height: number;
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
          if (!Number.isInteger(emoji.width) || emoji.width <= 0 ||
              !Number.isInteger(emoji.height) || emoji.height <= 0 ||
              emoji.pixels.byteLength < emoji.width * emoji.height * 4) {
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
