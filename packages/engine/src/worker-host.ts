import type { WorkerMessage } from './protocol.js';

/** Where the engine's assets live, as passed to a worker factory. */
export interface PdfWorkerUrls {
  /** Absolute URL of `pdfium_worker.js`, a classic worker script. */
  workerUrl: string;
  /**
   * Absolute URL of `pdfium.wasm`. The worker script reads it from the global
   * `pdfiumWasmUrl`, which the bootstrap must define before running the script.
   */
  wasmUrl: string;
}

/**
 * The part of the Web Worker API this engine uses. A browser `Worker` satisfies
 * it as is; on hosts without one (Node) the engine wraps their equivalent.
 */
export interface PdfWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** Reserved for internal use only. Shape of the globals the engine sniffs for. @internal */
interface HostGlobals {
  document?: { baseURI?: string };
  process?: { cwd?: () => string; versions?: { node?: string } };
  Worker?: unknown;
}

const host = globalThis as HostGlobals;

/**
 * Whether the host is a browser (or a browser-like worker scope), which decides
 * both how relative URLs resolve and how the worker is started.
 * @internal
 */
function isBrowser(): boolean {
  return typeof host.document?.baseURI === 'string';
}

/**
 * What relative URLs resolve against when the caller does not say: the document
 * base URL in a browser, the current directory on a server runtime.
 * @internal
 */
export function defaultBaseUrl(): string {
  const base = host.document?.baseURI;
  if (base !== undefined) return base;
  const cwd = host.process?.cwd?.();
  if (cwd !== undefined) {
    const path = cwd.replace(/\\/g, '/').replace(/\/?$/, '/');
    return new URL(`file://${path.startsWith('/') ? '' : '/'}${encodeURI(path)}`).toString();
  }
  throw new Error('pdfrx: cannot tell what relative URLs are relative to here; pass the baseUrl option');
}

/**
 * Runs `pdfium_worker.js` on whatever this host offers: a Web Worker in a
 * browser, a module worker on Bun/Deno (no `importScripts` there), or a
 * `node:worker_threads` worker on Node.
 * @internal
 */
export function createDefaultWorker(urls: PdfWorkerUrls): PdfWorkerLike | Promise<PdfWorkerLike> {
  if (typeof host.Worker === 'function') {
    return isBrowser() ? createClassicWorker(urls) : createModuleWorker(urls);
  }
  return createNodeWorker(urls);
}

/**
 * Browser: a bootstrap blob injects the wasm URL and `importScripts` the worker
 * script. Going through a blob sidesteps the same-origin restriction on the
 * `Worker` constructor, so the assets may live on any origin.
 * @internal
 */
function createClassicWorker({ workerUrl, wasmUrl }: PdfWorkerUrls): PdfWorkerLike {
  const bootstrap = `const pdfiumWasmUrl=${JSON.stringify(wasmUrl)};importScripts(${JSON.stringify(workerUrl)});`;
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }));
  try {
    return new (host.Worker as typeof Worker)(blobUrl) as unknown as PdfWorkerLike;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Bun/Deno: their workers are ES modules, which have no `importScripts`, so the
 * bootstrap fetches the classic worker script and evaluates it. The blob URL is
 * not revoked because the worker starts asynchronously there.
 * @internal
 */
function createModuleWorker({ workerUrl, wasmUrl }: PdfWorkerUrls): PdfWorkerLike {
  const bootstrap = `
globalThis.self ??= globalThis;
globalThis.location ??= { href: ${JSON.stringify(workerUrl)} };
globalThis.pdfiumWasmUrl = ${JSON.stringify(wasmUrl)};
(0, eval)(await (await fetch(${JSON.stringify(workerUrl)})).text());
`;
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }));
  return new (host.Worker as typeof Worker)(blobUrl, { type: 'module' }) as unknown as PdfWorkerLike;
}

/**
 * Node's worker bootstrap: makes `node:worker_threads` look like a Web Worker
 * to the classic worker script, and teaches `fetch` about `file:` URLs, which
 * Node's own refuses and the wasm is commonly loaded from.
 * @internal
 */
const NODE_BOOTSTRAP = `
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

globalThis.self = globalThis;
globalThis.location = { href: workerData.workerUrl };
globalThis.pdfiumWasmUrl = workerData.wasmUrl;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);

// Commands can arrive before the worker script has assigned globalThis.onmessage.
const queued = [];
parentPort.on('message', (data) => {
  if (globalThis.onmessage) globalThis.onmessage({ data });
  else queued.push(data);
});

const nodeFetch = globalThis.fetch;
const readLocal = (url) => readFile(fileURLToPath(url));
globalThis.fetch = async (input, init) => {
  const url = input?.url ?? String(input);
  if (!url.startsWith('file:')) return nodeFetch(input, init);
  const type = url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
  return new Response(await readLocal(url), { headers: { 'content-type': type } });
};

const source = workerData.workerUrl.startsWith('file:')
  ? await readLocal(workerData.workerUrl)
  : await (await nodeFetch(workerData.workerUrl)).text();
(0, eval)(String(source));

for (const data of queued) globalThis.onmessage({ data });
`;

/**
 * Node: no Web Worker, so wrap a `node:worker_threads` one. The specifier is
 * assembled at runtime to keep bundlers targeting the browser from trying to
 * resolve it.
 * @internal
 */
async function createNodeWorker(urls: PdfWorkerUrls): Promise<PdfWorkerLike> {
  const specifier = 'node:worker' + '_threads';
  const { Worker: NodeWorker } = (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)) as {
    Worker: new (url: URL, options: { workerData: PdfWorkerUrls }) => NodeWorkerLike;
  };
  const bootstrapUrl = new URL(`data:text/javascript,${encodeURIComponent(NODE_BOOTSTRAP)}`);
  const impl = new NodeWorker(bootstrapUrl, { workerData: urls });
  const worker: PdfWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message, transfer) => impl.postMessage(message, transfer),
    terminate: () => void impl.terminate(),
  };
  impl.on('message', (data: WorkerMessage) => worker.onmessage?.({ data }));
  impl.on('error', (error: Error) => worker.onerror?.({ message: error.message }));
  return worker;
}

/** The bits of a `node:worker_threads` worker used above. @internal */
interface NodeWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  on(event: string, listener: (arg: never) => void): void;
}
