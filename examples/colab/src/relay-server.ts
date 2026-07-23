import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PageArrangementError } from '@pdfrx/viewer-core';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AnnotationProtocolError,
  commitAnnotationOperation,
  commitPageOperation,
  commitFormOperation,
  FormProtocolError,
  parseClientRelayMessage,
  PageProtocolError,
  validatePageSessionSnapshot,
  type AnnotationSessionSnapshot,
  type FormSessionSnapshot,
  type PageSessionSnapshot,
  type ServerRelayMessage,
} from '@pdfrx/colab';

interface RelaySession {
  snapshot: PageSessionSnapshot;
  readonly clients: Set<WebSocket>;
  readonly sources: Map<string, Uint8Array>;
  annotationSnapshot: AnnotationSessionSnapshot;
  formSnapshot: FormSessionSnapshot;
}

export interface PageRelayServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly sessions?: Readonly<Record<string, PageSessionSnapshot>>;
}

export interface RunningPageRelayServer {
  readonly url: string;
  readonly relay: InMemoryPageRelay;
  close(): Promise<void>;
}

const send = (socket: WebSocket, message: ServerRelayMessage): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

/** Authoritative in-memory session state and WebSocket connection handler. */
export class InMemoryPageRelay {
  readonly #sessions = new Map<string, RelaySession>();

  createSession(sessionId: string, snapshot: PageSessionSnapshot): void {
    if (sessionId.length === 0) throw new Error('sessionId must not be empty');
    if (this.#sessions.has(sessionId)) throw new Error(`Session already exists: ${sessionId}`);
    validatePageSessionSnapshot(snapshot);
    this.#sessions.set(sessionId, {
      snapshot,
      clients: new Set(),
      sources: new Map(),
      annotationSnapshot: { revision: 0, annotations: [] },
      formSnapshot: { revision: 0, fields: [] },
    });
  }

  snapshot(sessionId: string): PageSessionSnapshot | null {
    return this.#sessions.get(sessionId)?.snapshot ?? null;
  }

  putSource(sessionId: string, documentId: string, bytes: Uint8Array): void {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new RelayRequestError('session-not-found', `Session not found: ${sessionId}`);
    if (documentId.length === 0 || bytes.byteLength === 0) throw new RelayRequestError('invalid-source', 'PDF source must not be empty');
    const existing = session.sources.get(documentId);
    if (existing && !Buffer.from(existing).equals(Buffer.from(bytes))) {
      throw new RelayRequestError('source-conflict', `Source id already contains different bytes: ${documentId}`);
    }
    session.sources.set(documentId, bytes);
  }

  source(sessionId: string, documentId: string): Uint8Array | null {
    return this.#sessions.get(sessionId)?.sources.get(documentId) ?? null;
  }

  attach(socket: WebSocket): void {
    let joined: { sessionId: string; session: RelaySession } | null = null;
    const leave = (): void => {
      joined?.session.clients.delete(socket);
      joined = null;
    };

    socket.on('close', leave);
    socket.on('message', (data) => {
      try {
        const message = parseClientRelayMessage(data.toString());
        if (message.type === 'session.join') {
          const session = this.#sessions.get(message.sessionId);
          if (!session) throw new RelayRequestError('session-not-found', `Session not found: ${message.sessionId}`);
          leave();
          joined = { sessionId: message.sessionId, session };
          session.clients.add(socket);
          send(socket, { type: 'session.snapshot', sessionId: message.sessionId, snapshot: session.snapshot });
          send(socket, { type: 'annotation.snapshot', sessionId: message.sessionId, snapshot: session.annotationSnapshot });
          send(socket, { type: 'form.snapshot', sessionId: message.sessionId, snapshot: session.formSnapshot });
          return;
        }
        if (!joined || joined.sessionId !== message.sessionId) {
          throw new RelayRequestError('not-joined', 'Join the session before submitting operations');
        }
        if (message.type === 'annotation.preview') {
          const preview: ServerRelayMessage = {
            type: 'annotation.preview',
            sessionId: joined.sessionId,
            preview: message.preview,
          };
          for (const client of joined.session.clients) {
            if (client !== socket) send(client, preview);
          }
          return;
        }
        let committed: ServerRelayMessage;
        if (message.type === 'page.operation') {
          const result = commitPageOperation(joined.session.snapshot, message.request);
          joined.session.snapshot = result.snapshot;
          committed = { type: 'page.committed', sessionId: joined.sessionId, committed: result.committed };
        } else if (message.type === 'annotation.operation') {
          const result = commitAnnotationOperation(joined.session.annotationSnapshot, joined.session.snapshot.pages, message.request);
          joined.session.annotationSnapshot = result.snapshot;
          committed = { type: 'annotation.committed', sessionId: joined.sessionId, committed: result.committed };
        } else {
          const result = commitFormOperation(joined.session.formSnapshot, joined.session.snapshot.pages, message.request);
          joined.session.formSnapshot = result.snapshot;
          committed = { type: 'form.committed', sessionId: joined.sessionId, committed: result.committed };
        }
        for (const client of joined.session.clients) send(client, committed);
      } catch (error) {
        const code = error instanceof PageProtocolError || error instanceof AnnotationProtocolError || error instanceof FormProtocolError || error instanceof PageArrangementError || error instanceof RelayRequestError
          ? error.code
          : 'invalid-message';
        const message = error instanceof Error ? error.message : String(error);
        let operationId: string | undefined;
        try {
          const value = JSON.parse(data.toString()) as { request?: { operationId?: unknown } };
          if (typeof value.request?.operationId === 'string') operationId = value.request.operationId;
        } catch {
          // The rejection below is the only response needed for malformed JSON.
        }
        send(socket, {
          type: 'operation.rejected',
          sessionId: joined?.sessionId,
          operationId,
          code,
          message,
          currentRevision: joined?.session.snapshot.revision,
        });
      }
    });
  }
}

class RelayRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RelayRequestError';
  }
}

/** Starts an ephemeral or fixed-port WebSocket relay suitable for development and tests. */
export async function startPageRelayServer(options: PageRelayServerOptions = {}): Promise<RunningPageRelayServer> {
  const relay = new InMemoryPageRelay();
  for (const [sessionId, snapshot] of Object.entries(options.sessions ?? {})) relay.createSession(sessionId, snapshot);
  const httpServer = createServer((request, response) => handleSourceRequest(relay, request, response));
  const server = new WebSocketServer({ server: httpServer });
  server.on('connection', (socket) => relay.attach(socket));
  httpServer.listen(options.port ?? 0, options.host ?? '127.0.0.1');
  await once(httpServer, 'listening');
  const address = httpServer.address();
  if (address === null) throw new Error('WebSocket server did not expose a listening address');
  if (typeof address === 'string') throw new Error(`Unexpected WebSocket server address: ${address}`);
  return {
    url: `ws://${address.address}:${address.port}`,
    relay,
    close: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}

const SOURCE_PATH = /^\/sessions\/([^/]+)\/sources\/([^/]+)$/;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

function handleSourceRequest(relay: InMemoryPageRelay, request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const match = new URL(request.url ?? '/', 'http://relay.invalid').pathname.match(SOURCE_PATH);
  if (!match) {
    response.writeHead(404).end('Not found');
    return;
  }
  const sessionId = decodeURIComponent(match[1]!);
  const documentId = decodeURIComponent(match[2]!);
  if (request.method === 'GET') {
    const bytes = relay.source(sessionId, documentId);
    if (!bytes) {
      response.writeHead(404).end('Source not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.byteLength });
    response.end(bytes);
    return;
  }
  if (request.method !== 'PUT') {
    response.writeHead(405).end('Method not allowed');
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk: Buffer) => {
    size += chunk.byteLength;
    if (size > MAX_SOURCE_BYTES) request.destroy(new Error('PDF source exceeds 50 MiB'));
    else chunks.push(chunk);
  });
  request.on('error', (error) => {
    if (!response.headersSent) response.writeHead(413).end(error.message);
  });
  request.on('end', () => {
    try {
      relay.putSource(sessionId, documentId, Buffer.concat(chunks));
      response.writeHead(201).end();
    } catch (error) {
      const status = error instanceof RelayRequestError && error.code === 'source-conflict' ? 409 : 400;
      response.writeHead(status).end(error instanceof Error ? error.message : String(error));
    }
  });
}
