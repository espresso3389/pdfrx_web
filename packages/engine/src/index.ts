/**
 * @packageDocumentation
 * `@pdfrx/engine` — a typed client for rendering PDF documents.
 *
 * The heavy work runs off the main thread in a dedicated worker (a WASM
 * rendering engine); this package speaks a `postMessage` command protocol to
 * that worker and exposes an idiomatic, `Promise`-based object model on top of
 * it. The worker is started the way the host runs workers — a Web Worker in a
 * browser, the platform equivalent on Node, Bun and Deno — so the same package
 * works on a server runtime without extra configuration.
 *
 * The primary entry point is {@link PdfrxEngine}: construct one with the URL of
 * the directory that hosts the bundled WASM assets (`pdfium_worker.js` and
 * `pdfium.wasm`), then open documents with {@link PdfrxEngine.openUrl},
 * {@link PdfrxEngine.openData}, {@link PdfrxEngine.createNew}, or
 * {@link PdfrxEngine.createFromImages}. Opened documents are represented by
 * {@link PdfDocument}, their pages by {@link PdfPage}, and rendered bitmaps by
 * {@link PdfImage}.
 *
 */

export type { PdfWorkerLike, PdfWorkerUrls } from './worker-host.js';
export type { PdfrxFontCacheOptions, PdfrxLocalFontsOptions } from './local-fonts.js';
export {
  PdfDocument,
  PdfPage,
  PdfrxEngine,
  type PdfEncodeMode,
  type PdfEncodeOptions,
  type PdfMaterializedCopyCatalog,
  type PdfMaterializedCopyOptions,
  type PdfOpenDataOptions,
  type PdfOpenOptions,
  type PdfOpenUrlOptions,
  type PdfPageRenderOptions,
  type PdfRawCreatedObject,
  type PdfRawObjectEditOptions,
  type PdfRawObjectEditor,
  type PdfrxEngineOptions,
} from './document.js';
export {
  canDecodeImages,
  isJpeg,
  readJpegSize,
  type PdfCreateFromImagesOptions,
  type PdfImageDecoder,
  type PdfImageDecoderResult,
  type PdfImageSource,
  type PdfRawImage,
} from './image-source.js';
export { PdfPageRenderCancellationToken } from './render-queue.js';
export type {
  PdfColor,
  PdfCreateFromPageContentsOptions,
  PdfEmojiRun,
  PdfImageContent,
  PdfMatrix,
  PdfPageContentObject,
  PdfPageContentSpec,
  PdfPageImageSource,
  PdfPathContent,
  PdfPathSegment,
  PdfTextContent,
  PdfTextRun,
} from './page-content.js';
export { deserializeAnnotationSnapshot, serializeAnnotationSnapshot } from './annotation-storage.js';
export {
  PdfMemoryTextAssetCache,
  PdfIndexedDbTextAssetCache,
  createCanvasTextMeasureProvider,
  createDefaultEmojiRenderer,
  createNotoEmojiPngSource,
  decodeRgbaPng,
  defaultNotoEmojiPngBaseUrl,
  prepareFreeTextAppearance,
  type PdfDefaultEmojiRendererOptions,
  type PdfEmojiAssetSource,
  type PdfEmojiImage,
  type PdfEmojiRenderer,
  type PdfFreeTextAppearanceOptions,
  type PdfFreeTextFontResolver,
  type PdfNotoEmojiSourceOptions,
  type PdfTextAppearanceServices,
  type PdfTextAssetCache,
  type PdfTextMeasureProvider,
} from './text-appearance.js';
export {
  parseCalcAction,
  evaluateCalc,
  parseFieldNumber,
  type FormCalcOp,
  type FormCalcSpec,
} from './form-calc.js';
export * from './types.js';
export type {
  PdfRawObject,
  PdfRawPatchOperation,
  PdfRawPatchValue,
  PdfRawTarget,
  PdfPixelFormat,
} from './protocol.js';
export { PdfErrorCode } from './protocol.js';
