import type { PagePlacementOperation } from '@pdfrx/viewer-core';
import {
  applyCommittedPageOperation,
  validatePageSessionSnapshot,
  type CommittedPageOperation,
  type PageOperationRequest,
  type PageSessionSnapshot,
} from './protocol.js';
import { parseServerRelayMessage, type ClientRelayMessage } from './wire.js';
import {
  applyCommittedAnnotationOperation,
  type AnnotationOperationRequest,
  type AnnotationSessionSnapshot,
  type CommittedAnnotationOperation,
  type SharedAnnotationChange,
} from './annotation-protocol.js';
import {
  applyCommittedFormOperation,
  type CommittedFormOperation,
  type FormOperationRequest,
  type FormSessionSnapshot,
  type SharedFormFieldChange,
} from './form-protocol.js';

export interface CollaborationWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: Event | MessageEvent) => void): void;
}

export type CollaborationWebSocketFactory = (url: string) => CollaborationWebSocket;
export type PageSessionListener = (snapshot: PageSessionSnapshot, committed?: CommittedPageOperation) => void;
export type AnnotationSessionListener = (snapshot: AnnotationSessionSnapshot, committed?: CommittedAnnotationOperation) => void;
export type FormSessionListener = (snapshot: FormSessionSnapshot, committed?: CommittedFormOperation) => void;

export function relaySourceUrl(relayUrl: string, sessionId: string, documentId: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = `/sessions/${encodeURIComponent(sessionId)}/sources/${encodeURIComponent(documentId)}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function uploadRelaySource(
  relayUrl: string,
  sessionId: string,
  documentId: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const response = await fetch(relaySourceUrl(relayUrl, sessionId, documentId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: bytes,
  });
  if (!response.ok) throw new Error(`PDF source upload failed (${response.status}): ${await response.text()}`);
}

interface QueuedOperation {
  readonly operationId: string;
  readonly operation: PagePlacementOperation;
  readonly resolve: (committed: CommittedPageOperation) => void;
  readonly reject: (error: Error) => void;
}

interface QueuedAnnotationOperation {
  readonly operationId: string;
  readonly change: SharedAnnotationChange;
  readonly resolve: (committed: CommittedAnnotationOperation) => void;
  readonly reject: (error: Error) => void;
}

interface QueuedFormOperation {
  readonly operationId: string;
  readonly change: SharedFormFieldChange;
  readonly resolve: (committed: CommittedFormOperation) => void;
  readonly reject: (error: Error) => void;
}

export class RelayOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = 'RelayOperationError';
  }
}

/** Browser-side strict-revision client. Local operations are sent one at a time. */
export class PageCollaborationClient {
  readonly #listeners = new Set<PageSessionListener>();
  readonly #annotationListeners = new Set<AnnotationSessionListener>();
  readonly #formListeners = new Set<FormSessionListener>();
  readonly #queue: QueuedOperation[] = [];
  #socket: CollaborationWebSocket | null = null;
  #sessionId: string | null = null;
  #snapshot: PageSessionSnapshot | null = null;
  #pending: QueuedOperation | null = null;
  readonly #annotationQueue: QueuedAnnotationOperation[] = [];
  #annotationSnapshot: AnnotationSessionSnapshot | null = null;
  #annotationPending: QueuedAnnotationOperation | null = null;
  readonly #formQueue: QueuedFormOperation[] = [];
  #formSnapshot: FormSessionSnapshot | null = null;
  #formPending: QueuedFormOperation | null = null;

  constructor(
    readonly actorId: string,
    readonly createOperationId: () => string = () => crypto.randomUUID(),
    readonly createSocket: CollaborationWebSocketFactory = (url) => new WebSocket(url),
  ) {
    if (actorId.length === 0) throw new Error('actorId must not be empty');
  }

  get snapshot(): PageSessionSnapshot | null {
    return this.#snapshot;
  }

  get annotationSnapshot(): AnnotationSessionSnapshot | null {
    return this.#annotationSnapshot;
  }

  get formSnapshot(): FormSessionSnapshot | null {
    return this.#formSnapshot;
  }

  subscribe(listener: PageSessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeAnnotations(listener: AnnotationSessionListener): () => void {
    this.#annotationListeners.add(listener);
    if (this.#annotationSnapshot) listener(this.#annotationSnapshot);
    return () => this.#annotationListeners.delete(listener);
  }

  subscribeForms(listener: FormSessionListener): () => void {
    this.#formListeners.add(listener);
    if (this.#formSnapshot) listener(this.#formSnapshot);
    return () => this.#formListeners.delete(listener);
  }

  connect(url: string, sessionId: string): Promise<PageSessionSnapshot> {
    if (this.#socket) throw new Error('Client is already connected');
    if (sessionId.length === 0) return Promise.reject(new Error('sessionId must not be empty'));
    this.#sessionId = sessionId;
    const socket = this.createSocket(url);
    this.#socket = socket;
    return new Promise<PageSessionSnapshot>((resolve, reject) => {
      let joined = false;
      socket.addEventListener('open', () => this.#send({ type: 'session.join', sessionId }));
      socket.addEventListener('message', (event) => {
        try {
          const data = (event as MessageEvent).data;
          const message = parseServerRelayMessage(typeof data === 'string' ? data : String(data));
          if (message.type === 'session.snapshot') {
            if (message.sessionId !== sessionId) throw new Error(`Unexpected session: ${message.sessionId}`);
            validatePageSessionSnapshot(message.snapshot);
            this.#snapshot = message.snapshot;
            joined = true;
            resolve(message.snapshot);
            this.#notify();
            this.#pump();
          } else if (message.type === 'annotation.snapshot') {
            if (message.sessionId !== sessionId) throw new Error(`Unexpected session: ${message.sessionId}`);
            this.#annotationSnapshot = message.snapshot;
            this.#notifyAnnotations();
            this.#pumpAnnotations();
          } else if (message.type === 'form.snapshot') {
            if (message.sessionId !== sessionId) throw new Error(`Unexpected session: ${message.sessionId}`);
            this.#formSnapshot = message.snapshot;
            this.#notifyForms();
            this.#pumpForms();
          } else if (message.type === 'page.committed') {
            if (!this.#snapshot || message.sessionId !== sessionId) return;
            this.#snapshot = applyCommittedPageOperation(this.#snapshot, message.committed);
            this.#notify(message.committed);
            if (this.#pending?.operationId === message.committed.operationId) {
              const pending = this.#pending;
              this.#pending = null;
              pending.resolve(message.committed);
              this.#pump();
            }
          } else if (message.type === 'annotation.committed') {
            if (!this.#annotationSnapshot || message.sessionId !== sessionId) return;
            this.#annotationSnapshot = applyCommittedAnnotationOperation(this.#annotationSnapshot, message.committed);
            this.#notifyAnnotations(message.committed);
            if (this.#annotationPending?.operationId === message.committed.operationId) {
              const pending = this.#annotationPending;
              this.#annotationPending = null;
              pending.resolve(message.committed);
              this.#pumpAnnotations();
            }
          } else if (message.type === 'form.committed') {
            if (!this.#formSnapshot || message.sessionId !== sessionId) return;
            this.#formSnapshot = applyCommittedFormOperation(this.#formSnapshot, message.committed);
            this.#notifyForms(message.committed);
            if (this.#formPending?.operationId === message.committed.operationId) {
              const pending = this.#formPending;
              this.#formPending = null;
              pending.resolve(message.committed);
              this.#pumpForms();
            }
          } else {
            const error = new RelayOperationError(message.code, message.message, message.currentRevision);
            if (!joined) reject(error);
            if (this.#pending && (!message.operationId || message.operationId === this.#pending.operationId)) {
              const pending = this.#pending;
              this.#pending = null;
              pending.reject(error);
              this.#pump();
            }
            if (this.#annotationPending && (!message.operationId || message.operationId === this.#annotationPending.operationId)) {
              const pending = this.#annotationPending;
              this.#annotationPending = null;
              pending.reject(error);
              this.#pumpAnnotations();
            }
            if (this.#formPending && (!message.operationId || message.operationId === this.#formPending.operationId)) {
              const pending = this.#formPending;
              this.#formPending = null;
              pending.reject(error);
              this.#pumpForms();
            }
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          if (!joined) reject(failure);
          this.#fail(failure);
        }
      });
      socket.addEventListener('error', () => {
        if (!joined) reject(new Error('WebSocket connection failed'));
      });
      socket.addEventListener('close', () => {
        const error = new Error('WebSocket connection closed');
        if (!joined) reject(error);
        this.#socket = null;
        this.#fail(error);
      });
    });
  }

  submit(operation: PagePlacementOperation): Promise<CommittedPageOperation> {
    if (!this.#socket || !this.#sessionId) return Promise.reject(new Error('Client is not connected'));
    const operationId = this.createOperationId();
    if (operationId.length === 0) return Promise.reject(new Error('createOperationId returned an empty id'));
    return new Promise<CommittedPageOperation>((resolve, reject) => {
      this.#queue.push({ operationId, operation, resolve, reject });
      this.#pump();
    });
  }

  submitAnnotation(change: SharedAnnotationChange): Promise<CommittedAnnotationOperation> {
    if (!this.#socket || !this.#sessionId) return Promise.reject(new Error('Client is not connected'));
    const operationId = this.createOperationId();
    if (operationId.length === 0) return Promise.reject(new Error('createOperationId returned an empty id'));
    return new Promise((resolve, reject) => {
      this.#annotationQueue.push({ operationId, change, resolve, reject });
      this.#pumpAnnotations();
    });
  }

  submitForm(change: SharedFormFieldChange): Promise<CommittedFormOperation> {
    if (!this.#socket || !this.#sessionId) return Promise.reject(new Error('Client is not connected'));
    const operationId = this.createOperationId();
    if (operationId.length === 0) return Promise.reject(new Error('createOperationId returned an empty id'));
    return new Promise((resolve, reject) => {
      this.#formQueue.push({ operationId, change, resolve, reject });
      this.#pumpForms();
    });
  }

  close(): void {
    this.#socket?.close();
  }

  #send(message: ClientRelayMessage): void {
    if (!this.#socket) throw new Error('Client is not connected');
    this.#socket.send(JSON.stringify(message));
  }

  #pump(): void {
    if (this.#pending || !this.#snapshot || !this.#sessionId || !this.#socket) return;
    const next = this.#queue.shift();
    if (!next) return;
    this.#pending = next;
    const request: PageOperationRequest = {
      operationId: next.operationId,
      actorId: this.actorId,
      baseRevision: this.#snapshot.revision,
      operation: next.operation,
    };
    this.#send({ type: 'page.operation', sessionId: this.#sessionId, request });
  }

  #pumpAnnotations(): void {
    if (this.#annotationPending || !this.#annotationSnapshot || !this.#sessionId || !this.#socket) return;
    const next = this.#annotationQueue.shift();
    if (!next) return;
    this.#annotationPending = next;
    const request: AnnotationOperationRequest = {
      operationId: next.operationId,
      actorId: this.actorId,
      baseRevision: this.#annotationSnapshot.revision,
      change: next.change,
    };
    this.#send({ type: 'annotation.operation', sessionId: this.#sessionId, request });
  }

  #pumpForms(): void {
    if (this.#formPending || !this.#formSnapshot || !this.#sessionId || !this.#socket) return;
    const next = this.#formQueue.shift();
    if (!next) return;
    this.#formPending = next;
    const request: FormOperationRequest = {
      operationId: next.operationId,
      actorId: this.actorId,
      baseRevision: this.#formSnapshot.revision,
      change: next.change,
    };
    this.#send({ type: 'form.operation', sessionId: this.#sessionId, request });
  }

  #notify(committed?: CommittedPageOperation): void {
    if (!this.#snapshot) return;
    for (const listener of this.#listeners) listener(this.#snapshot, committed);
  }

  #notifyAnnotations(committed?: CommittedAnnotationOperation): void {
    if (!this.#annotationSnapshot) return;
    for (const listener of this.#annotationListeners) listener(this.#annotationSnapshot, committed);
  }

  #notifyForms(committed?: CommittedFormOperation): void {
    if (!this.#formSnapshot) return;
    for (const listener of this.#formListeners) listener(this.#formSnapshot, committed);
  }

  #fail(error: Error): void {
    this.#pending?.reject(error);
    this.#pending = null;
    for (const queued of this.#queue.splice(0)) queued.reject(error);
    this.#annotationPending?.reject(error);
    this.#annotationPending = null;
    for (const queued of this.#annotationQueue.splice(0)) queued.reject(error);
    this.#formPending?.reject(error);
    this.#formPending = null;
    for (const queued of this.#formQueue.splice(0)) queued.reject(error);
  }
}
