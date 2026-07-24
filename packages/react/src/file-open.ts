import type { PdfDocument, PdfPasswordProvider, PdfrxEngine } from '@pdfrx/engine';

/** Image extensions used to classify typeless `File`s (e.g. from some drag sources). */
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|avif|apng|ico|svg)$/i;

/** Whether a `File` looks like an image the runtime can decode (by MIME type, or extension when typeless). */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return file.type === '' && IMAGE_EXTENSION.test(file.name);
}

/** Whether a `File` looks like a PDF (by MIME type or `.pdf` extension). */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** True when the byte stream contains the `%PDF-` signature near its start (within 1 KB). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Converts encoded image bytes into a one-page PDF (one page showing the image),
 * returning the PDF bytes. The temporary document is disposed before returning,
 * so the result is a standalone PDF that can be opened by any engine.
 */
export async function imageBytesToPdf(engine: PdfrxEngine, bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const doc = await engine.createFromImages([bytes]);
  try {
    return await doc.encodePdf();
  } finally {
    await doc.dispose();
  }
}

/**
 * Opens a `File` as a {@link PdfDocument} in the given engine — PDFs directly,
 * images converted to a one-page-per-image document. The returned document lives
 * in `engine`'s worker, so its pages can be imported into another document from
 * the same engine (e.g. via {@link PdfDocument.setPages}).
 *
 * The caller owns the returned document. When its pages are borrowed into
 * another document, keep it open for as long as they are referenced.
 *
 * `passwordProvider` is consulted when the file is an encrypted PDF; images
 * never need it.
 */
export async function openFileAsDocument(
  engine: PdfrxEngine,
  file: File,
  options: { passwordProvider?: PdfPasswordProvider } = {},
): Promise<PdfDocument> {
  if (isImageFile(file)) {
    return engine.createFromImages([file], { sourceName: file.name });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikePdf(bytes)) {
    return engine.openData(bytes, { sourceName: file.name, passwordProvider: options.passwordProvider });
  }
  // Typeless and not a PDF: try to decode it as an image (createImageBitmap
  // sniffs the format from the bytes, so a missing MIME type is fine).
  return engine.createFromImages([bytes], { sourceName: file.name });
}
