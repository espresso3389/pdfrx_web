import type { PdfPage } from '@pdfrx/engine';
import type { PdfrxViewer } from '@pdfrx/viewer';
import { parseSvgAnnotation } from './svg-annotation.js';

/** Adds an image as a stamp annotation, centered on the requested page. */
export async function addCenteredImageAnnotation(
  viewer: PdfrxViewer,
  file: File,
  pageNumber: number | null = viewer.currentPageNumber,
): Promise<void> {
  const page = pageNumber === null ? undefined : viewer.document?.pages[pageNumber - 1];
  if (!page) return;
  const source = await annotationImageSource(file);
  const rect = centeredImageRect(page, source.width, source.height);
  await page.addAnnotation({
    subtype: 'stamp',
    rect,
    flags: 4,
    appearanceImage: source.image ?? undefined,
    appearancePaths: source.paths,
  });
}

/** Adds an image as a stamp annotation centered at a point, constrained to its page. */
export async function addDroppedImageAnnotation(
  page: PdfPage,
  file: File,
  center: { x: number; y: number },
): Promise<void> {
  const source = await annotationImageSource(file);
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

async function annotationImageSource(file: File): Promise<{
  width: number;
  height: number;
  image: { width: number; height: number; pixels: Uint8Array } | null;
  paths?: NonNullable<ReturnType<typeof parseSvgAnnotation>>['paths'];
}> {
  const vector = isSvgFile(file) ? parseSvgAnnotation(await file.text()) : null;
  const image = vector ? null : await decodeAnnotationImage(file);
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
async function decodeAnnotationImage(file: File): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const bitmap = await createImageBitmap(file);
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
