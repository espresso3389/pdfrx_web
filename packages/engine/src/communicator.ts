import type { WorkerCommand, WorkerCommandMap, WorkerMessage } from './protocol.js';
import { RenderQueue, type PdfPageRenderCancellationToken } from './render-queue.js';
import { createDefaultWorker, defaultBaseUrl, type PdfWorkerLike, type PdfWorkerUrls } from './worker-host.js';

/** Options for constructing a {@link WorkerCommunicator}. */
export interface WorkerCommunicatorOptions {
  /**
   * Base URL of the directory that contains `pdfium_worker.js` and `pdfium.wasm`.
   * Relative URLs are resolved against {@link baseUrl}.
   */
  wasmModulesUrl: string;
  /**
   * What relative URLs — {@link wasmModulesUrl} and the ones passed to
   * `PdfrxEngine.openUrl` — resolve against. Defaults to `document.baseURI` in a
   * browser and to the current working directory elsewhere.
   */
  baseUrl?: string;
  /** Extra headers sent when the worker fetches `pdfium.wasm`. */
  headers?: Record<string, string>;
  /** Whether the worker's `pdfium.wasm` fetch includes credentials. */
  withCredentials?: boolean;
  /**
   * Escape hatch for starting the worker yourself, for a host the engine does
   * not already know (it handles browsers, Node, Bun and Deno on its own) or one
   * that needs its worker configured — permissions, resource limits, a
   * self-hosted copy of `pdfium_worker.js`. Return anything that behaves like a
   * Web Worker; see {@link PdfWorkerLike} and {@link PdfWorkerUrls}.
   */
  createWorker?: (urls: PdfWorkerUrls) => PdfWorkerLike | Promise<PdfWorkerLike>;
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
 * Owns the rendering worker and speaks its raw command protocol. The worker is
 * started the way the host runs workers — a Web Worker in a browser, the
 * platform equivalent on Node, Bun and Deno — unless
 * {@link WorkerCommunicatorOptions.createWorker} says otherwise.
 */
export class WorkerCommunicator {
  /**
   * The worker, which some hosts can only produce asynchronously. Commands are
   * posted from `.then` callbacks on it, which run in call order, so awaiting it
   * per command does not reorder them.
   */
  private readonly workerPromise: Promise<PdfWorkerLike>;
  /** The worker once it exists, so {@link dispose} can terminate it right away. */
  private worker: PdfWorkerLike | null = null;
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
    this.baseUrl = options.baseUrl ?? defaultBaseUrl();
    const base = new URL(options.wasmModulesUrl, this.baseUrl);
    const workerUrl = new URL('pdfium_worker.js', base).toString();
    const wasmUrl = new URL('pdfium.wasm', base).toString();

    this.workerPromise = Promise.resolve((options.createWorker ?? createDefaultWorker)({ workerUrl, wasmUrl })).then(
      (worker) => {
        if (this.disposed) {
          worker.terminate();
          throw new Error('WorkerCommunicator is disposed');
        }
        worker.onmessage = (event) => this.onMessage(event.data);
        worker.onerror = (event) => {
          const error = new Error(`worker error: ${event.message ?? 'unknown'}`);
          for (const pending of this.pending.values()) {
            pending.reject(error);
          }
          this.pending.clear();
        };
        this.worker = worker;
        return worker;
      },
    );

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
      this.workerPromise.then(
        (worker) => worker.postMessage({ id, command, parameters }, transfer ?? []),
        (error: Error) => {
          this.pending.delete(id);
          reject(error);
        },
      );
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
    // A worker still being started terminates itself once it arrives.
    this.worker?.terminate();
    const error = new Error('WorkerCommunicator is disposed');
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.callbacks.clear();
  }
}
