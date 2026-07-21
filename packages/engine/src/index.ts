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
 * Lower-level building blocks — {@link WorkerCommunicator} and the wire types in
 * {@link WorkerCommandMap} — are also exported for advanced use.
 */

export { WorkerCommunicator, type WorkerCommunicatorOptions } from './communicator.js';
export type { PdfWorkerLike, PdfWorkerUrls } from './worker-host.js';
export {
  PdfDocument,
  PdfPage,
  PdfrxEngine,
  type PdfOpenOptions,
  type PdfOpenUrlOptions,
  type PdfPageRenderOptions,
  type PdfrxEngineOptions,
} from './document.js';
export {
  canDecodeImages,
  isJpeg,
  readJpegSize,
  type PdfCreateFromImagesOptions,
  type PdfImageDecoder,
  type PdfImageSource,
  type PdfRawImage,
} from './image-source.js';
export { PdfPageRenderCancellationToken } from './render-queue.js';
export {
  parseCalcAction,
  evaluateCalc,
  parseFieldNumber,
  type FormCalcOp,
  type FormCalcSpec,
} from './form-calc.js';
export * from './types.js';
export type {
  WorkerCommand,
  WorkerCommandMap,
  WorkerMessage,
  WireAnnotation,
  WireDest,
  WireDocument,
  WireError,
  WireFontQueries,
  WireFontQuery,
  WireFormField,
  WireFormFieldOption,
  WireFormNotification,
  WireImagePage,
  WireLink,
  WireOutlineNode,
  WirePageInfo,
  WirePixelFormat,
  WireRect,
} from './protocol.js';
export { isWireError, PdfErrorCode } from './protocol.js';
