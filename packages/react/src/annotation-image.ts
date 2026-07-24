import type { PdfImageDecoder, PdfImageDecoderResult, PdfPage, PdfRawImage } from '@pdfrx/engine';
import type { PdfrxViewer } from '@pdfrx/viewer';
import { parseSvgAnnotation } from './svg-annotation.js';

const IMAGE_DECODE_TIMEOUT_MS = 5_000;

/**
 * Adds an image as a stamp annotation, centered on the requested page.
 *
 * Raster inputs retain up to 2048 pixels on their longest side independently
 * of their initial 240-point on-page placement. SVG inputs remain vector paths.
 */
export async function addCenteredImageAnnotation(
  viewer: PdfrxViewer,
  file: File,
  pageNumber: number | null = viewer.currentPageNumber,
  imageDecoder?: PdfImageDecoder,
): Promise<void> {
  const page = pageNumber === null ? undefined : viewer.document?.pages[pageNumber - 1];
  if (!page) return;
  const source = await annotationImageSource(file, imageDecoder);
  const rect = centeredImageRect(page, source.width, source.height);
  await page.addAnnotation({
    subtype: 'stamp',
    rect,
    flags: 4,
    appearanceImage: source.image ?? undefined,
    appearancePaths: source.paths,
  });
}

/**
 * Adds an image as a stamp annotation centered at a point, constrained to its
 * page. Raster inputs retain up to 2048 pixels on their longest side
 * independently of their initial 240-point on-page placement; SVG stays vector.
 */
export async function addDroppedImageAnnotation(
  page: PdfPage,
  file: File,
  center: { x: number; y: number },
  imageDecoder?: PdfImageDecoder,
): Promise<void> {
  const source = await annotationImageSource(file, imageDecoder);
  const rect = imageRect(page, source.width, source.height, center);
  await page.addAnnotation({
    subtype: 'stamp',
    rect,
    flags: 4,
    appearanceImage: source.image ?? undefined,
    appearancePaths: source.paths,
  });
}

export function centeredImageRect(
  page: Pick<PdfPage, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number,
): { left: number; bottom: number; right: number; top: number } {
  return imageRect(page, sourceWidth, sourceHeight, { x: page.width / 2, y: page.height / 2 });
}

function imageRect(
  page: Pick<PdfPage, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number,
  center: { x: number; y: number },
): { left: number; bottom: number; right: number; top: number } {
  const maxDimension = 240;
  const scale = Math.min(
    1,
    maxDimension / sourceWidth,
    page.width / sourceWidth,
    page.height / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const left = Math.max(0, Math.min(page.width - width, center.x - width / 2));
  const bottom = Math.max(0, Math.min(page.height - height, center.y - height / 2));
  return { left, bottom, right: left + width, top: bottom + height };
}

async function annotationImageSource(file: File, imageDecoder?: PdfImageDecoder): Promise<{
  width: number;
  height: number;
  image: { width: number; height: number; pixels: Uint8Array } | null;
  paths?: NonNullable<ReturnType<typeof parseSvgAnnotation>>['paths'];
}> {
  const vector = isSvgFile(file) ? parseSvgAnnotation(await file.text()) : null;
  const image = vector ? null : await decodeAnnotationImage(file, imageDecoder);
  return {
    width: vector?.width ?? image!.width,
    height: vector?.height ?? image!.height,
    image,
    paths: vector?.paths,
  };
}

function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

/** Decodes an image file to bounded RGBA pixels suitable for worker transfer. */
async function decodeAnnotationImage(
  file: File,
  imageDecoder?: PdfImageDecoder,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  if (imageDecoder) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = await imageDecoder(bytes, file.type || inferMimeTypeFromFileName(file.name));
    if (decoded !== null) {
      if (isRawImage(decoded)) return rawImageToRgba(decoded);
      const blob = decoded instanceof Blob
        ? decoded
        : new Blob([decoded instanceof Uint8Array ? decoded as BlobPart : decoded]);
      return decodeAnnotationEncoded(blob);
    }
  }
  return decodeAnnotationEncoded(file);
}

async function decodeAnnotationEncoded(source: Blob): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const bitmap = await createImageBitmapWithTimeout(source);
  try {
    const maxDimension = 2048;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    return { width, height, pixels: new Uint8Array(data.data) };
  } finally {
    bitmap.close();
  }
}

function inferMimeTypeFromFileName(name: string): string | undefined {
  if (/\.heic$/i.test(name)) return 'image/heic';
  if (/\.heif$/i.test(name)) return 'image/heif';
  return undefined;
}

function createImageBitmapWithTimeout(source: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`The source image could not be decoded within ${IMAGE_DECODE_TIMEOUT_MS / 1000} seconds`));
    }, IMAGE_DECODE_TIMEOUT_MS);
    void createImageBitmap(source).then(
      (bitmap) => {
        if (timedOut) {
          bitmap.close();
          return;
        }
        clearTimeout(timer);
        resolve(bitmap);
      },
      (error: unknown) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRawImage(image: PdfImageDecoderResult): image is PdfRawImage {
  return typeof image === 'object' && image !== null && 'pixels' in image;
}

function rawImageToRgba(image: PdfRawImage): { width: number; height: number; pixels: Uint8Array } {
  if (!(image.width > 0) || !(image.height > 0)) throw new Error('PdfRawImage requires positive width and height');
  const source = image.pixels instanceof Uint8Array ? image.pixels : new Uint8Array(image.pixels);
  if (source.byteLength !== image.width * image.height * 4) {
    throw new Error('PdfRawImage pixels must contain width * height * 4 bytes');
  }
  const pixels = new Uint8Array(source);
  if (image.format === 'bgra8888') {
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i]!;
      pixels[i] = pixels[i + 2]!;
      pixels[i + 2] = red;
    }
  }
  return { width: image.width, height: image.height, pixels };
}
