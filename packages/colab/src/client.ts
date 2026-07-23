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
  type AnnotationPreview,
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

/** Minimal browser WebSocket surface used by {@link PageCollaborationClient}. */
export interface CollaborationWebSocket {
  /** Native WebSocket ready-state value. */
  readonly readyState: number;
  /** Sends one serialized relay message. */
  send(data: string): void;
  /** Begins a normal socket close. */
  close(): void;
  /** Registers a browser-compatible socket event listener. */
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: Event | MessageEvent) => void): void;
}

/** Factory override used by tests or hosts that provide a WebSocket polyfill. */
export type CollaborationWebSocketFactory = (url: string) => CollaborationWebSocket;
/** Fetch-compatible hook used for authenticated source download and upload. */
export type CollaborationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
/** Resolves the immutable source endpoint used by the collaboration session. */
export type RelaySourceUrlResolver = (relayUrl: string, sessionId: string, documentId: string) => string;

/** Credentials sent in the encrypted WebSocket join payload. */
export interface CollaborationJoinOptions {
  /** Device-specific membership token. It is never appended to the relay URL. */
  readonly memberToken?: string;
  /** Participant display name used for approval requests. */
  readonly displayName?: string;
  /** Rejoin automatically after a connection that completed successfully closes. */
  readonly reconnect?: boolean;
  /** Delay before automatic reconnection. Defaults to 1500 milliseconds. */
  readonly reconnectDelayMs?: number;
}

/**
 * Host-provided transport hooks for authentication and custom relay routing.
 *
 * The defaults use the browser's native `WebSocket` and `fetch`, and derive a
 * root-level HTTP source path from the relay URL. Applications can inject a
 * credentialed fetch, a ticket-bearing socket factory, or a reverse-proxy
 * specific source URL without coupling the package to one auth provider.
 */
export interface CollaborationTransport {
  /** Creates the relay socket; useful for short-lived connection tickets or polyfills. */
  readonly createWebSocket?: CollaborationWebSocketFactory;
  /** Performs source GET/PUT requests; add credentials or authorization here. */
  readonly fetch?: CollaborationFetch;
  /** Overrides source HTTP URL construction. */
  readonly resolveSourceUrl?: RelaySourceUrlResolver;
}
/** Receives the current page snapshot and, for incremental updates, its commit. */
export type PageSessionListener = (snapshot: PageSessionSnapshot, committed?: CommittedPageOperation) => void;
/** Receives the current annotation snapshot and optional incremental commit. */
export type AnnotationSessionListener = (snapshot: AnnotationSessionSnapshot, committed?: CommittedAnnotationOperation) => void;
/** @internal Receives non-persistent annotation geometry while another participant drags. */
export type AnnotationPreviewListener = (preview: AnnotationPreview) => void;
/** Receives the current form snapshot and optional incremental commit. */
export type FormSessionListener = (snapshot: FormSessionSnapshot, committed?: CommittedFormOperation) => void;
/** Join request shown to already admitted participants. */
export interface CollaborationJoinRequest {
  readonly requestId: string;
  readonly actorId: string;
  readonly displayName: string;
}
/** Receives a pending participant request that any current member may approve. */
export type CollaborationJoinRequestListener = (request: CollaborationJoinRequest) => void;
/** Receives the id of a join request resolved by any current member. */
export type CollaborationJoinResolutionListener = (requestId: string) => void;
/** Current relay connection lifecycle state. */
export type CollaborationConnectionState = 'connecting' | 'connected' | 'disconnected';
/** Receives relay connection lifecycle changes. */
export type CollaborationConnectionStateListener = (state: CollaborationConnectionState) => void;
/** Receives the number of participants currently connected to the session. */
export type CollaborationPresenceListener = (connectedCount: number) => void;

/** Converts a relay WebSocket endpoint into its session source HTTP endpoint. */
export function relaySourceUrl(relayUrl: string, sessionId: string, documentId: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = `/sessions/${encodeURIComponent(sessionId)}/sources/${encodeURIComponent(documentId)}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Fetches one immutable source using optional host transport hooks. */
export function fetchRelaySource(
  relayUrl: string,
  sessionId: string,
  documentId: string,
  transport: CollaborationTransport = {},
): Promise<Response> {
  const url = (transport.resolveSourceUrl ?? relaySourceUrl)(relayUrl, sessionId, documentId);
  return transport.fetch ? transport.fetch(url) : globalThis.fetch(url);
}

/**
 * Uploads one immutable PDF source to the reference relay's HTTP endpoint.
 * @throws `Error` when the relay rejects or cannot store the source.
 */
export async function uploadRelaySource(
  relayUrl: string,
  sessionId: string,
  documentId: string,
  bytes: ArrayBuffer,
  transport: CollaborationTransport = {},
): Promise<void> {
  const url = (transport.resolveSourceUrl ?? relaySourceUrl)(relayUrl, sessionId, documentId);
  const init: RequestInit = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: bytes,
  };
  const response = transport.fetch ? await transport.fetch(url, init) : await globalThis.fetch(url, init);
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

/** Operation rejection returned by the relay, optionally with its current revision. */
export class RelayOperationError extends Error {
  /**
   * @param code Machine-readable error category supplied by the relay.
   * @param message Human-readable relay diagnostic.
   * @param currentRevision Relay revision included for stale-operation recovery.
   */
  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = 'RelayOperationError';
  }
}

/**
 * Browser-side client for the reference strict-revision relay protocol.
 *
 * Page, annotation, and form operations have independent queues and revision
 * streams. Each stream sends one local operation at a time and resolves its
 * promise only after the relay broadcasts the authoritative commit.
 */
export class PageCollaborationClient {
  readonly #listeners = new Set<PageSessionListener>();
  readonly #annotationListeners = new Set<AnnotationSessionListener>();
  readonly #annotationPreviewListeners = new Set<AnnotationPreviewListener>();
  readonly #formListeners = new Set<FormSessionListener>();
  readonly #joinRequestListeners = new Set<CollaborationJoinRequestListener>();
  readonly #joinResolutionListeners = new Set<CollaborationJoinResolutionListener>();
  readonly #connectionStateListeners = new Set<CollaborationConnectionStateListener>();
  readonly #presenceListeners = new Set<CollaborationPresenceListener>();
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
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #closedByUser = false;
  #initialized = false;
  #connectionState: CollaborationConnectionState = 'disconnected';

  constructor(
    /** Stable participant id attached to every submitted operation. */
    readonly actorId: string,
    /** Generates operation correlation ids; injectable for deterministic tests. */
    readonly createOperationId: () => string = () => crypto.randomUUID(),
    /** Creates the transport socket; defaults to the browser `WebSocket`. */
    readonly createSocket: CollaborationWebSocketFactory = (url) => new WebSocket(url),
  ) {
    if (actorId.length === 0) throw new Error('actorId must not be empty');
  }

  /** Latest authoritative page snapshot, or `null` until the session is joined. */
  get snapshot(): PageSessionSnapshot | null {
    return this.#snapshot;
  }

  /** Latest authoritative annotation snapshot, or `null` before initialization. */
  get annotationSnapshot(): AnnotationSessionSnapshot | null {
    return this.#annotationSnapshot;
  }

  /** Latest authoritative form snapshot, or `null` before initialization. */
  get formSnapshot(): FormSessionSnapshot | null {
    return this.#formSnapshot;
  }

  /** Subscribes to page snapshots. The listener is called after subsequent commits. */
  subscribe(listener: PageSessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Subscribes to annotation state and immediately emits an existing snapshot. */
  subscribeAnnotations(listener: AnnotationSessionListener): () => void {
    this.#annotationListeners.add(listener);
    if (this.#annotationSnapshot) listener(this.#annotationSnapshot);
    return () => this.#annotationListeners.delete(listener);
  }

  /** @internal Subscribes to transient annotation drag previews. */
  subscribeAnnotationPreviews(listener: AnnotationPreviewListener): () => void {
    this.#annotationPreviewListeners.add(listener);
    return () => this.#annotationPreviewListeners.delete(listener);
  }

  /** Subscribes to form state and immediately emits an existing snapshot. */
  subscribeForms(listener: FormSessionListener): () => void {
    this.#formListeners.add(listener);
    if (this.#formSnapshot) listener(this.#formSnapshot);
    return () => this.#formListeners.delete(listener);
  }

  /** Subscribes to requests from participants waiting for admission. */
  subscribeJoinRequests(listener: CollaborationJoinRequestListener): () => void {
    this.#joinRequestListeners.add(listener);
    return () => this.#joinRequestListeners.delete(listener);
  }

  /** Subscribes to approved, rejected, or cancelled join-request resolutions. */
  subscribeJoinRequestResolutions(listener: CollaborationJoinResolutionListener): () => void {
    this.#joinResolutionListeners.add(listener);
    return () => this.#joinResolutionListeners.delete(listener);
  }

  /** Subscribes to relay connection lifecycle changes. */
  subscribeConnectionState(listener: CollaborationConnectionStateListener): () => void {
    this.#connectionStateListeners.add(listener);
    listener(this.#connectionState);
    return () => this.#connectionStateListeners.delete(listener);
  }

  /** Subscribes to the current connected-participant count. */
  subscribePresence(listener: CollaborationPresenceListener): () => void {
    this.#presenceListeners.add(listener);
    return () => this.#presenceListeners.delete(listener);
  }

  /**
   * Opens the relay socket and joins `sessionId`.
   * @returns The initial authoritative page snapshot.
   * @throws `Error` if already connected, the session is invalid, or joining fails.
   */
  connect(url: string, sessionId: string, options: CollaborationJoinOptions = {}): Promise<PageSessionSnapshot> {
    if (this.#socket) throw new Error('Client is already connected');
    if (sessionId.length === 0) return Promise.reject(new Error('sessionId must not be empty'));
    this.#sessionId = sessionId;
    this.#closedByUser = false;
    this.#initialized = false;
    this.#setConnectionState('connecting');
    const socket = this.createSocket(url);
    this.#socket = socket;
    return new Promise<PageSessionSnapshot>((resolve, reject) => {
      let joined = false;
      let receivedPages = false;
      let receivedAnnotations = false;
      let receivedForms = false;
      const finishJoin = (): void => {
        if (joined || !receivedPages || !receivedAnnotations || !receivedForms || !this.#snapshot) return;
        joined = true;
        this.#initialized = true;
        this.#setConnectionState('connected');
        resolve(this.#snapshot);
        this.#pump();
        this.#pumpAnnotations();
        this.#pumpForms();
      };
      socket.addEventListener('open', () => this.#send({
        type: 'session.join',
        sessionId,
        actorId: this.actorId,
        ...(options.memberToken !== undefined ? { memberToken: options.memberToken } : {}),
        ...(options.displayName !== undefined ? { displayName: options.displayName } : {}),
      }));
      socket.addEventListener('message', (event) => {
        try {
          const data = (event as MessageEvent).data;
          const message = parseServerRelayMessage(typeof data === 'string' ? data : String(data));
          if (message.type === 'session.snapshot') {
            if (message.sessionId !== sessionId) throw new Error(`Unexpected session: ${message.sessionId}`);
            validatePageSessionSnapshot(message.snapshot);
            this.#snapshot = message.snapshot;
            receivedPages = true;
            this.#notify();
            finishJoin();
          } else if (message.type === 'annotation.snapshot') {
            if (message.sessionId !== sessionId) throw new Error(`Unexpected session: ${message.sessionId}`);
            this.#annotationSnapshot = message.snapshot;
            receivedAnnotations = true;
            this.#notifyAnnotations();
            finishJoin();
          } else if (message.type === 'form.snapshot') {
            if (message.sessionId !== sessionId) throw new Error(`Unexpected session: ${message.sessionId}`);
            this.#formSnapshot = message.snapshot;
            receivedForms = true;
            this.#notifyForms();
            finishJoin();
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
          } else if (message.type === 'annotation.preview') {
            if (message.sessionId !== sessionId || message.preview.actorId === this.actorId) return;
            for (const listener of this.#annotationPreviewListeners) listener(message.preview);
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
          } else if (message.type === 'session.join.request') {
            if (message.sessionId !== sessionId) return;
            const request = {
              requestId: message.requestId,
              actorId: message.actorId,
              displayName: message.displayName,
            };
            for (const listener of this.#joinRequestListeners) listener(request);
          } else if (message.type === 'session.join.resolved') {
            if (message.sessionId !== sessionId) return;
            for (const listener of this.#joinResolutionListeners) listener(message.requestId);
          } else if (message.type === 'session.presence') {
            if (message.sessionId !== sessionId) return;
            for (const listener of this.#presenceListeners) listener(message.connectedCount);
          } else if (
            message.type === 'session.join.pending' ||
            message.type === 'session.join.approved' ||
            message.type === 'session.join.rejected'
          ) {
            if (!joined) reject(new Error('Session membership approval is required before connecting'));
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
            if (
              message.code === 'page-revision-mismatch' ||
              message.code === 'annotation-revision-mismatch' ||
              message.code === 'form-revision-mismatch'
            ) {
              socket.close();
            }
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          if (!joined) reject(failure);
          this.#fail(failure);
          if (joined) socket.close();
        }
      });
      socket.addEventListener('error', () => {
        if (!joined) reject(new Error('WebSocket connection failed'));
      });
      socket.addEventListener('close', () => {
        const error = new Error('WebSocket connection closed');
        if (!joined) reject(error);
        this.#socket = null;
        this.#initialized = false;
        this.#setConnectionState('disconnected');
        this.#fail(error);
        if (joined && options.reconnect && !this.#closedByUser) {
          this.#scheduleReconnect(url, sessionId, options);
        }
      });
    });
  }

  /** Queues a page operation and resolves after its authoritative commit. */
  submit(operation: PagePlacementOperation): Promise<CommittedPageOperation> {
    if (!this.#socket || !this.#sessionId) return Promise.reject(new Error('Client is not connected'));
    const operationId = this.createOperationId();
    if (operationId.length === 0) return Promise.reject(new Error('createOperationId returned an empty id'));
    return new Promise<CommittedPageOperation>((resolve, reject) => {
      this.#queue.push({ operationId, operation, resolve, reject });
      this.#pump();
    });
  }

  /** Queues an annotation mutation and resolves after its authoritative commit. */
  submitAnnotation(change: SharedAnnotationChange): Promise<CommittedAnnotationOperation> {
    if (!this.#socket || !this.#sessionId) return Promise.reject(new Error('Client is not connected'));
    const operationId = this.createOperationId();
    if (operationId.length === 0) return Promise.reject(new Error('createOperationId returned an empty id'));
    return new Promise((resolve, reject) => {
      this.#annotationQueue.push({ operationId, change, resolve, reject });
      this.#pumpAnnotations();
    });
  }

  /** @internal Broadcasts a non-persistent annotation drag preview without a revision. */
  sendAnnotationPreview(changes: AnnotationPreview['changes']): void {
    if (!this.#socket || !this.#sessionId || changes.length === 0) return;
    this.#send({
      type: 'annotation.preview',
      sessionId: this.#sessionId,
      preview: { actorId: this.actorId, changes },
    });
  }

  /** Queues a source-scoped form value and resolves after its authoritative commit. */
  submitForm(change: SharedFormFieldChange): Promise<CommittedFormOperation> {
    if (!this.#socket || !this.#sessionId) return Promise.reject(new Error('Client is not connected'));
    const operationId = this.createOperationId();
    if (operationId.length === 0) return Promise.reject(new Error('createOperationId returned an empty id'));
    return new Promise((resolve, reject) => {
      this.#formQueue.push({ operationId, change, resolve, reject });
      this.#pumpForms();
    });
  }

  /** Approves one pending participant using the current admitted connection. */
  approveJoin(requestId: string): void {
    if (!this.#socket || !this.#sessionId) throw new Error('Client is not connected');
    if (requestId.length === 0) throw new Error('requestId must not be empty');
    this.#send({ type: 'session.approve', sessionId: this.#sessionId, requestId });
  }

  /** Rejects one pending participant using the current admitted connection. */
  rejectJoin(requestId: string): void {
    if (!this.#socket || !this.#sessionId) throw new Error('Client is not connected');
    if (requestId.length === 0) throw new Error('requestId must not be empty');
    this.#send({ type: 'session.reject', sessionId: this.#sessionId, requestId });
  }

  /** Closes the transport. Any queued or pending operations are rejected. */
  close(): void {
    this.#closedByUser = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close();
  }

  #send(message: ClientRelayMessage): void {
    if (!this.#socket) throw new Error('Client is not connected');
    this.#socket.send(JSON.stringify(message));
  }

  #scheduleReconnect(url: string, sessionId: string, options: CollaborationJoinOptions): void {
    if (this.#reconnectTimer || this.#closedByUser) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#closedByUser || this.#socket) return;
      void this.connect(url, sessionId, options).catch(() => {
        this.#scheduleReconnect(url, sessionId, options);
      });
    }, options.reconnectDelayMs ?? 1500);
  }

  #setConnectionState(state: CollaborationConnectionState): void {
    if (this.#connectionState === state) return;
    this.#connectionState = state;
    for (const listener of this.#connectionStateListeners) listener(state);
  }

  #pump(): void {
    if (this.#pending || !this.#initialized || !this.#snapshot || !this.#sessionId || !this.#socket) return;
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
    if (this.#annotationPending || !this.#initialized || !this.#annotationSnapshot || !this.#sessionId || !this.#socket) return;
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
    if (this.#formPending || !this.#initialized || !this.#formSnapshot || !this.#sessionId || !this.#socket) return;
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
