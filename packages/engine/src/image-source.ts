import type { WireImagePage, WirePixelFormat } from './protocol.js';

/**
 * Already-decoded image pixels. Provide these directly when the runtime cannot
 * decode the format on its own (e.g. Node, which has no `createImageBitmap`),
 * or to skip decoding when you already hold raw pixels.
 */
export interface PdfRawImage {
  /** Tightly packed pixels, `width * height * 4` bytes. */
  pixels: Uint8Array | ArrayBuffer;
  /** Pixel width of the bitmap. */
  width: number;
  /** Pixel height of the bitmap. */
  height: number;
  /** Byte order of {@link pixels}. Default `'rgba8888'` (what a canvas produces). */
  format?: WirePixelFormat;
}

/**
 * One image handed to {@link PdfrxEngine.createFromImages}. Either encoded bytes
 * (a `Blob`, `Uint8Array`, or `ArrayBuffer`) that get decoded, or a
 * {@link PdfRawImage} of pixels that are used as-is.
 */
export type PdfImageSource = Blob | Uint8Array | ArrayBuffer | PdfRawImage;

/**
 * Decodes encoded image bytes to {@link PdfRawImage} pixels. Supply one via
 * {@link PdfCreateFromImagesOptions.decode} on runtimes without a built-in
 * decoder (JPEG never needs one — PDFium decodes it natively).
 */
export type PdfImageDecoder = (bytes: Uint8Array, mimeType?: string) => Promise<PdfRawImage> | PdfRawImage;

/** Options for {@link PdfrxEngine.createFromImages}. */
export interface PdfCreateFromImagesOptions {
  /** Identifier used in error messages and for caching purposes. Default `'images'`. */
  sourceName?: string;
  /**
   * Pixels-per-inch used to convert an image's pixel size into the page size in
   * points. Default `72` (1 pixel = 1 point). Ignored for any image whose page
   * size is fixed by {@link pageSize}.
   */
  dpi?: number;
  /**
   * Fixed page size in points (1/72 inch) applied to every page; the image is
   * scaled to fill it. When omitted, each page is sized from its own image via
   * {@link dpi}.
   */
  pageSize?: { width: number; height: number };
  /**
   * Decoder for non-JPEG formats. Falls back to `createImageBitmap` +
   * `OffscreenCanvas` when available (browsers, workers, Deno, Bun) and, failing
   * that, throws — so pass this (or pre-decoded {@link PdfRawImage}s) on Node.
   */
  decode?: PdfImageDecoder;
}

/** True for a byte stream that begins with the JPEG SOI marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Reads a JPEG's pixel dimensions from its `SOFn` marker without decoding the
 * image, so JPEG pages can be sized without a pixel decoder. Throws if the bytes
 * are not a JPEG whose size can be found.
 */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.byteLength;
  if (len < 2 || view.getUint16(0) !== 0xffd8) throw new Error('Not a JPEG image');
  let offset = 2;
  while (offset < len) {
    // Markers are 0xFF followed by a non-0xFF, non-0x00 id; skip any 0xFF fill run.
    if (view.getUint8(offset) !== 0xff) {
      offset++;
      continue;
    }
    while (offset < len && view.getUint8(offset) === 0xff) offset++;
    if (offset >= len) break;
    const marker = view.getUint8(offset);
    offset++;
    // Standalone markers (SOI/EOI/RSTn/TEM) carry no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }
    if (offset + 1 >= len) break;
    const segLen = view.getUint16(offset);
    // SOF0..SOF15, excluding DHT (0xC4), JPG (0xC8), and DAC (0xCC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 6 >= len) break;
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += segLen;
  }
  throw new Error('Could not read JPEG dimensions');
}

/** Whether the current runtime can decode encoded images without a user-supplied decoder. */
export function canDecodeImages(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
}

/** Decodes encoded image bytes to RGBA pixels via `createImageBitmap` + `OffscreenCanvas`. */
async function decodeWithCanvas(bytes: Uint8Array, mimeType?: string): Promise<PdfRawImage> {
  const blob = new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined);
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not obtain a 2D canvas context to decode the image');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { pixels: imageData.data.buffer, width, height, format: 'rgba8888' };
  } finally {
    bitmap.close();
  }
}

/** Copies `data` into a freshly owned `ArrayBuffer` that is safe to transfer. */
function toOwnedBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  return data.slice().buffer;
}

function pageSizeFor(
  pixelWidth: number,
  pixelHeight: number,
  options: PdfCreateFromImagesOptions,
): { width: number; height: number } {
  if (options.pageSize) return options.pageSize;
  const dpi = options.dpi && options.dpi > 0 ? options.dpi : 72;
  return { width: (pixelWidth * 72) / dpi, height: (pixelHeight * 72) / dpi };
}

function isRawImage(source: PdfImageSource): source is PdfRawImage {
  return (
    typeof source === 'object' &&
    source !== null &&
    !(source instanceof ArrayBuffer) &&
    !(source instanceof Uint8Array) &&
    !(typeof Blob !== 'undefined' && source instanceof Blob) &&
    'pixels' in source
  );
}

function rawImageToPage(image: PdfRawImage, options: PdfCreateFromImagesOptions): WireImagePage {
  if (!(image.width > 0) || !(image.height > 0)) {
    throw new Error('PdfRawImage requires positive width and height');
  }
  const { width, height } = pageSizeFor(image.width, image.height, options);
  return {
    kind: 'pixels',
    pixels: toOwnedBuffer(image.pixels),
    pixelWidth: image.width,
    pixelHeight: image.height,
    format: image.format ?? 'rgba8888',
    width,
    height,
  };
}

/** Reads a single encoded source into bytes plus its MIME type (if a `Blob`). */
async function encodedSourceBytes(
  source: Blob | Uint8Array | ArrayBuffer,
): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  if (source instanceof Uint8Array) return { bytes: source };
  if (source instanceof ArrayBuffer) return { bytes: new Uint8Array(source) };
  return { bytes: new Uint8Array(await source.arrayBuffer()), mimeType: source.type || undefined };
}

/** Converts one {@link PdfImageSource} into a {@link WireImagePage}. */
async function sourceToPage(source: PdfImageSource, options: PdfCreateFromImagesOptions): Promise<WireImagePage> {
  if (isRawImage(source)) return rawImageToPage(source, options);

  const { bytes, mimeType } = await encodedSourceBytes(source);
  if (isJpeg(bytes)) {
    const { width: pw, height: ph } = options.pageSize ? { width: 0, height: 0 } : readJpegSize(bytes);
    const { width, height } = pageSizeFor(pw, ph, options);
    return { kind: 'jpeg', data: toOwnedBuffer(bytes), width, height };
  }

  const decode = options.decode ?? (canDecodeImages() ? decodeWithCanvas : undefined);
  if (!decode) {
    throw new Error(
      'This runtime cannot decode this image format. Pass options.decode, or provide pre-decoded PdfRawImage pixels ' +
        '(only JPEG is decoded natively without a decoder).',
    );
  }
  const decoded = await decode(bytes, mimeType);
  return rawImageToPage(decoded, options);
}

/**
 * Converts every {@link PdfImageSource} into wire pages and gathers the
 * `ArrayBuffer`s to transfer to the worker. Decoding (when needed) happens here,
 * on the calling thread.
 */
export async function imageSourcesToWirePages(
  images: PdfImageSource[],
  options: PdfCreateFromImagesOptions,
): Promise<{ pages: WireImagePage[]; transfer: ArrayBuffer[] }> {
  const pages: WireImagePage[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const source of images) {
    const page = await sourceToPage(source, options);
    pages.push(page);
    transfer.push(page.kind === 'jpeg' ? page.data : page.pixels);
  }
  return { pages, transfer };
}
