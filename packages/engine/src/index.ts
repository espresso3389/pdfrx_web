/**
 * @packageDocumentation
 * `@pdfrx/engine` — a TypeScript port of the WASM/pdfium backend of the Dart
 * library {@link https://pub.dev/packages/pdfrx | pdfrx}.
 *
 * The package renders PDF documents in the browser using pdfium compiled to
 * WebAssembly. All pdfium work happens off the main thread in a dedicated Web
 * Worker; this package speaks a `postMessage` command protocol to that worker
 * and exposes an idiomatic, `Promise`-based object model on top of it.
 *
 * The primary entry point is {@link PdfrxEngine}: construct one with the URL of
 * the directory that hosts the bundled pdfium wasm assets (`pdfium_worker.js`
 * and `pdfium.wasm`), then open documents with {@link PdfrxEngine.openUrl},
 * {@link PdfrxEngine.openData}, {@link PdfrxEngine.createNew}, or
 * {@link PdfrxEngine.createFromJpegData}. Opened documents are represented by
 * {@link PdfDocument}, their pages by {@link PdfPage}, and rendered bitmaps by
 * {@link PdfImage}.
 *
 * Lower-level building blocks — {@link PdfiumWorkerCommunicator} and the wire
 * types in {@link PdfiumCommandMap} — are also exported for advanced use.
 */

export { PdfiumWorkerCommunicator, type PdfiumWorkerOptions } from './communicator.js';
export {
  PdfDocument,
  PdfPage,
  PdfrxEngine,
  type PdfOpenOptions,
  type PdfOpenUrlOptions,
  type PdfPageRenderOptions,
  type PdfrxEngineOptions,
} from './document.js';
export * from './types.js';
export type {
  PdfiumCommand,
  PdfiumCommandMap,
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
export { isWireError, PdfiumErrorCode } from './protocol.js';
