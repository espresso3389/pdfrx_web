import type { WorkerCommand, WorkerCommandMap, WorkerMessage } from './protocol.js';
import { RenderQueue, type PdfPageRenderCancellationToken } from './render-queue.js';

/** Options for constructing a {@link WorkerCommunicator}. */
export interface WorkerCommunicatorOptions {
  /**
   * Base URL of the directory that contains `pdfium_worker.js` and `pdfium.wasm`.
   * Relative URLs are resolved against {@link baseUrl}.
   */
  wasmModulesUrl: string;
  /**
   * What relative URLs — {@link wasmModulesUrl} and the ones passed to
   * `PdfrxEngine.openUrl` — resolve against. Defaults to `document.baseURI`,
   * which only exists in a browser: outside one (Node, Bun, Deno) this is
   * required, and an absolute `file:`/`http:` URL of the directory the relative
   * URLs should be read from is what to pass.
   */
  baseUrl?: string;
  /** Extra headers sent when the worker fetches `pdfium.wasm`. */
  headers?: Record<string, string>;
  /** Whether the worker's `pdfium.wasm` fetch includes credentials. */
  withCredentials?: boolean;
  /**
   * Spawns the worker that runs `pdfium_worker.js`. Defaults to a Web
   * `Worker` started from a bootstrap blob, which is browser-only — supply this
   * to run the engine anywhere else (see {@link PdfWorkerLike}).
   */
  createWorker?: (urls: PdfWorkerUrls) => PdfWorkerLike;
}

/** Where {@link WorkerCommunicatorOptions.createWorker} finds the engine's assets. */
export interface PdfWorkerUrls {
  /** Absolute URL of `pdfium_worker.js`, a classic worker script. */
  workerUrl: string;
  /**
   * Absolute URL of `pdfium.wasm`. The worker script reads it from the global
   * `pdfiumWasmUrl`, which must be set before the script runs.
   */
  wasmUrl: string;
}

/**
 * The part of the Web Worker API this engine uses, so that
 * {@link WorkerCommunicatorOptions.createWorker} can return something else —
 * a `node:worker_threads` worker wrapped to look like this one, for instance.
 * A browser `Worker` satisfies it as is.
 */
export interface PdfWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/**
 * Resolves what relative URLs are taken to be relative to, falling back to the
 * document base URL in a browser.
 * @internal
 */
function resolveBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl !== undefined) return baseUrl;
  const base = (globalThis as { document?: { baseURI?: string } }).document?.baseURI;
  if (base === undefined) {
    throw new Error('No document.baseURI to resolve relative URLs against; pass the baseUrl option');
  }
  return base;
}

/**
 * Starts `pdfium_worker.js` in a Web Worker, via a bootstrap blob that injects
 * the wasm URL and `importScripts` the worker script. Going through a blob
 * sidesteps the same-origin restriction on the `Worker` constructor, so the
 * assets may live on any origin.
 * @internal
 */
function createWebWorker({ workerUrl, wasmUrl }: PdfWorkerUrls): PdfWorkerLike {
  const bootstrap = `const pdfiumWasmUrl=${JSON.stringify(wasmUrl)};importScripts(${JSON.stringify(workerUrl)});`;
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }));
  try {
    return new Worker(blobUrl) as unknown as PdfWorkerLike;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * A command request awaiting its worker reply.
 * @internal
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Owns the rendering worker and speaks its raw command protocol. By default the
 * worker is a Web Worker spawned via a small bootstrap blob, so that the worker
 * script and wasm can live on any origin; supply
 * {@link WorkerCommunicatorOptions.createWorker} to run it elsewhere.
 */
export class WorkerCommunicator {
  private readonly worker: PdfWorkerLike;
  /** What relative URLs resolve against; see {@link WorkerCommunicatorOptions.baseUrl}. */
  readonly baseUrl: string;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly callbacks = new Map<number, (...args: never[]) => void>();
  private requestId = 0;
  private callbackId = 0;
  private readonly initPromise: Promise<void>;
  private disposed = false;
  /** Renders are queued here rather than in the worker, so they stay cancellable. */
  private readonly renderQueue = new RenderQueue();

  /**
   * Spawns the worker and kicks off engine initialization. The worker starts
   * fetching `pdfium.wasm` immediately; await {@link ready} before relying on it.
   */
  constructor(options: WorkerCommunicatorOptions) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    const base = new URL(options.wasmModulesUrl, this.baseUrl);
    const workerUrl = new URL('pdfium_worker.js', base).toString();
    const wasmUrl = new URL('pdfium.wasm', base).toString();

    this.worker = (options.createWorker ?? createWebWorker)({ workerUrl, wasmUrl });

    this.worker.onmessage = (event) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(`worker error: ${event.message ?? 'unknown'}`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    };

    // The worker buffers commands until 'init' completes, so this can be sent
    // immediately; all subsequent commands are chained after it.
    this.initPromise = this.sendCommandRaw('init', {
      ...(options.headers ? { headers: options.headers } : {}),
      withCredentials: options.withCredentials ?? false,
    }).then(() => undefined);
  }

  /** Resolves when the worker has loaded and initialized the WASM engine. */
  get ready(): Promise<void> {
    return this.initPromise;
  }

  /**
   * Dispatches a {@link WorkerMessage}: resolves/rejects the matching pending
   * request, or routes an unsolicited `callback`/`error`/`ready` notification.
   * @internal
   */
  private onMessage(data: WorkerMessage): void {
    if ('type' in data) {
      switch (data.type) {
        case 'ready':
          return;
        case 'error':
          console.error('worker reported error:', data.error);
          return;
        case 'callback': {
          const callback = this.callbacks.get(data.callbackId);
          if (callback) {
            try {
              callback(...(data.args as never[]));
            } catch (e) {
              console.error('Error in worker callback:', e);
            }
          }
          return;
        }
      }
    }
    if ('id' in data) {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.status === 'success') {
        pending.resolve(data.result);
      } else {
        pending.reject(new Error(data.error, data.cause != null ? { cause: data.cause } : undefined));
      }
    }
  }

  /**
   * Sends a typed command to the worker and resolves with its typed result.
   *
   * Every command except `init` waits for {@link ready} first. Pass `transfer`
   * to hand ownership of `ArrayBuffer`s (e.g. document/JPEG/font bytes) to the
   * worker without copying.
   *
   * @param transfer Transferable objects to move (not copy) to the worker.
   */
  async sendCommand<C extends WorkerCommand>(
    command: C,
    parameters: WorkerCommandMap[C]['params'],
    transfer?: Transferable[],
  ): Promise<WorkerCommandMap[C]['result']> {
    if (command !== 'init') await this.initPromise;
    return (await this.sendCommandRaw(command, parameters, transfer)) as WorkerCommandMap[C]['result'];
  }

  /**
   * Posts a command with a fresh request id and returns a promise settled by
   * the worker's reply. Rejects immediately if the communicator is disposed.
   * @internal
   */
  private sendCommandRaw(command: string, parameters: unknown, transfer?: Transferable[]): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error('WorkerCommunicator is disposed'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, command, parameters }, transfer ?? []);
    });
  }

  /**
   * Runs `send` under the worker's render queue: it waits for a free slot and
   * resolves to `null` if `token` is cancelled first. Used by
   * {@link PdfPage.render} so a page that scrolls out of view can drop its
   * pending render instead of blocking the pages now on screen.
   * @internal
   */
  enqueueRender<T>(send: () => Promise<T>, token?: PdfPageRenderCancellationToken): Promise<T | null> {
    return this.renderQueue.enqueue(send, token);
  }

  /** Renders waiting for a worker slot (not counting the one being rendered). */
  get pendingRenderCount(): number {
    return this.renderQueue.pending;
  }

  /**
   * Registers a callback the worker can invoke by id (e.g. download progress),
   * and returns that id to pass along in a command's parameters.
   * Remember to {@link unregisterCallback} it when done to avoid leaks.
   */
  registerCallback(callback: (...args: never[]) => void): number {
    const id = ++this.callbackId;
    this.callbacks.set(id, callback);
    return id;
  }

  /** Removes a callback previously added with {@link registerCallback}. */
  unregisterCallback(id: number): void {
    this.callbacks.delete(id);
  }

  /** Terminates the worker. All documents opened through it become unusable. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderQueue.dispose();
    this.worker.terminate();
    const error = new Error('WorkerCommunicator is disposed');
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.callbacks.clear();
  }
}
