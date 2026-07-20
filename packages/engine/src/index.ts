/**
 * @packageDocumentation
 * `@pdfrx/engine` — a typed client for rendering PDF documents in the browser.
 *
 * The heavy work runs off the main thread in a dedicated Web Worker (a WASM
 * rendering engine); this package speaks a `postMessage` command protocol to
 * that worker and exposes an idiomatic, `Promise`-based object model on top of
 * it.
 *
 * The primary entry point is {@link PdfrxEngine}: construct one with the URL of
 * the directory that hosts the bundled WASM assets (`pdfium_worker.js` and
 * `pdfium.wasm`), then open documents with {@link PdfrxEngine.openUrl},
 * {@link PdfrxEngine.openData}, {@link PdfrxEngine.createNew}, or
 * {@link PdfrxEngine.createFromJpegData}. Opened documents are represented by
 * {@link PdfDocument}, their pages by {@link PdfPage}, and rendered bitmaps by
 * {@link PdfImage}.
 *
 * Lower-level building blocks — {@link WorkerCommunicator} and the wire types in
 * {@link WorkerCommandMap} — are also exported for advanced use.
 */

export {
  WorkerCommunicator,
  type PdfWorkerLike,
  type PdfWorkerUrls,
  type WorkerCommunicatorOptions,
} from './communicator.js';
export {
  PdfDocument,
  PdfPage,
  PdfrxEngine,
  type PdfOpenOptions,
  type PdfOpenUrlOptions,
  type PdfPageRenderOptions,
  type PdfrxEngineOptions,
} from './document.js';
export { PdfPageRenderCancellationToken } from './render-queue.js';
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
  WireLink,
  WireOutlineNode,
  WirePageInfo,
  WireRect,
} from './protocol.js';
export { isWireError, PdfErrorCode } from './protocol.js';
