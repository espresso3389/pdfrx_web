import type { PdfiumCommand, PdfiumCommandMap, WorkerMessage } from './protocol.js';

export interface PdfiumWorkerOptions {
  /**
   * Base URL of the directory that contains `pdfium_worker.js` and `pdfium.wasm`.
   * Relative URLs are resolved against `document.baseURI`.
   */
  wasmModulesUrl: string;
  /** Extra headers sent when the worker fetches `pdfium.wasm`. */
  headers?: Record<string, string>;
  /** Whether the worker's `pdfium.wasm` fetch includes credentials. */
  withCredentials?: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Owns the pdfium worker and speaks the raw command protocol.
 *
 * TypeScript counterpart of pdfrx's `pdfium_client.js` + the init logic in
 * `pdfrx_wasm.dart`. The worker is spawned via a small bootstrap blob so that
 * the worker script and wasm can live on any origin.
 */
export class PdfiumWorkerCommunicator {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly callbacks = new Map<number, (...args: never[]) => void>();
  private requestId = 0;
  private callbackId = 0;
  private readonly initPromise: Promise<void>;
  private disposed = false;

  constructor(options: PdfiumWorkerOptions) {
    const base = new URL(options.wasmModulesUrl, document.baseURI);
    const workerUrl = new URL('pdfium_worker.js', base).toString();
    const wasmUrl = new URL('pdfium.wasm', base).toString();

    // Bootstrap blob: injects the wasm URL and pulls in the worker script.
    // This sidesteps same-origin restrictions on the Worker constructor.
    const bootstrap = `const pdfiumWasmUrl=${JSON.stringify(wasmUrl)};importScripts(${JSON.stringify(workerUrl)});`;
    const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }));
    try {
      this.worker = new Worker(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(`pdfium worker error: ${event.message ?? 'unknown'}`);
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

  /** Resolves when the worker has loaded and initialized pdfium.wasm. */
  get ready(): Promise<void> {
    return this.initPromise;
  }

  private onMessage(data: WorkerMessage): void {
    if ('type' in data) {
      switch (data.type) {
        case 'ready':
          return;
        case 'error':
          console.error('pdfium worker reported error:', data.error);
          return;
        case 'callback': {
          const callback = this.callbacks.get(data.callbackId);
          if (callback) {
            try {
              callback(...(data.args as never[]));
            } catch (e) {
              console.error('Error in pdfium worker callback:', e);
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

  async sendCommand<C extends PdfiumCommand>(
    command: C,
    parameters: PdfiumCommandMap[C]['params'],
    transfer?: Transferable[],
  ): Promise<PdfiumCommandMap[C]['result']> {
    if (command !== 'init') await this.initPromise;
    return (await this.sendCommandRaw(command, parameters, transfer)) as PdfiumCommandMap[C]['result'];
  }

  private sendCommandRaw(command: string, parameters: unknown, transfer?: Transferable[]): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error('PdfiumWorkerCommunicator is disposed'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, command, parameters }, transfer ?? []);
    });
  }

  /** Registers a callback invocable from the worker; returns its id. */
  registerCallback(callback: (...args: never[]) => void): number {
    const id = ++this.callbackId;
    this.callbacks.set(id, callback);
    return id;
  }

  unregisterCallback(id: number): void {
    this.callbacks.delete(id);
  }

  /** Terminates the worker. All documents opened through it become unusable. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    const error = new Error('PdfiumWorkerCommunicator is disposed');
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.callbacks.clear();
  }
}
