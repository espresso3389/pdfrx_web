import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AnnotationProtocolError,
  commitAnnotationOperation,
  commitFormOperation,
  commitPageOperation,
  FormProtocolError,
  PageProtocolError,
  parseClientRelayMessage,
  type ServerRelayMessage,
} from '@pdfrx/colab';
import { PageArrangementError } from '@pdfrx/viewer-core';
import { SessionStore, type StoredSession } from './store.js';

const host = process.env.PDFRX_HOST ?? '127.0.0.1';
const port = Number(process.env.PDFRX_PORT ?? '5191');
const dataDirectory = resolve(process.env.PDFRX_DATA_DIR ?? './var/colab');
const apiPrefix = normalizedPrefix(process.env.PDFRX_API_PREFIX ?? '/api');
const relayPath = process.env.PDFRX_RELAY_PATH ?? '/relay';
const maxSourceBytes = Number(process.env.PDFRX_MAX_SOURCE_BYTES ?? 50 * 1024 * 1024);
const memberTokenHeader = 'x-pdfrx-member-token';
const store = new SessionStore(dataDirectory);
await store.open();

const clients = new Map<string, Set<WebSocket>>();
const socketSession = new WeakMap<WebSocket, StoredSession>();
const socketActorId = new WeakMap<WebSocket, string>();
const pendingJoins = new Map<string, {
  readonly socket: WebSocket;
  readonly session: StoredSession;
  readonly actorId: string;
  readonly displayName: string;
  readonly expires: ReturnType<typeof setTimeout>;
}>();
const admissionCooldowns = new Map<string, {
  readonly rejectionCount: number;
  readonly retryAt: number;
}>();
const sessionQueues = new Map<string, Promise<void>>();

const send = (socket: WebSocket, message: ServerRelayMessage): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

const broadcast = (sessionId: string, message: ServerRelayMessage, except?: WebSocket): void => {
  for (const client of clients.get(sessionId) ?? []) {
    if (client !== except) send(client, message);
  }
};

const broadcastPresence = (sessionId: string): void => {
  const actorIds = new Set(
    [...(clients.get(sessionId) ?? [])].map((client) => socketActorId.get(client) ?? `socket:${String(client)}`),
  );
  broadcast(sessionId, {
    type: 'session.presence',
    sessionId,
    connectedCount: actorIds.size,
  });
};

const enqueue = (
  sessionId: string,
  work: () => Promise<void>,
  onError: (error: unknown) => void,
): void => {
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(work, work);
  sessionQueues.set(sessionId, next);
  void next.catch(onError).finally(() => {
    if (sessionQueues.get(sessionId) === next) sessionQueues.delete(sessionId);
  });
};

const httpServer = createServer((request, response) => {
  void handleHttp(request, response).catch((error: unknown) => {
    if (!(error instanceof HttpError)) console.error(error);
    if (!response.headersSent) {
      json(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.code : 'internal-error',
      });
    }
    else response.end();
  });
});

const webSockets = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://relay.invalid').pathname;
  if (pathname !== relayPath) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit('connection', webSocket, request));
});

webSockets.on('connection', (socket) => {
  const leave = (): void => {
    for (const [requestId, pending] of pendingJoins) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.expires);
      pendingJoins.delete(requestId);
      broadcast(pending.session.id, {
        type: 'session.join.resolved',
        sessionId: pending.session.id,
        requestId,
        decision: 'cancelled',
      });
    }
    const session = socketSession.get(socket);
    if (!session) return;
    clients.get(session.id)?.delete(socket);
    socketSession.delete(socket);
    socketActorId.delete(socket);
    broadcastPresence(session.id);
  };
  socket.on('close', leave);
  socket.on('message', (data) => {
    let operationId: string | undefined;
    try {
      const message = parseClientRelayMessage(data.toString());
      if (message.type === 'session.join') {
        const session = store.get(message.sessionId);
        if (!session) throw new RelayError('session-not-found', 'セッションが見つかりません');
        if (!message.memberToken || !store.verifyMemberToken(session, message.memberToken)) {
          if (!message.actorId || !message.displayName?.trim()) {
            throw new RelayError('admission-required', '参加者による承認が必要です');
          }
          const cooldownKey = `${session.id}:${message.actorId}`;
          const cooldown = admissionCooldowns.get(cooldownKey);
          if (cooldown && cooldown.retryAt > Date.now()) {
            send(socket, {
              type: 'session.join.rejected',
              sessionId: session.id,
              requestId: '',
              retryAfterMs: cooldown.retryAt - Date.now(),
            });
            return;
          }
          const requestId = randomUUID();
          const expires = setTimeout(() => {
            if (!pendingJoins.delete(requestId)) return;
            broadcast(session.id, {
              type: 'session.join.resolved',
              sessionId: session.id,
              requestId,
              decision: 'cancelled',
            });
          }, 10 * 60 * 1000);
          pendingJoins.set(requestId, {
            socket,
            session,
            actorId: message.actorId,
            displayName: message.displayName.trim().slice(0, 80),
            expires,
          });
          send(socket, { type: 'session.join.pending', sessionId: session.id, requestId });
          broadcast(session.id, {
            type: 'session.join.request',
            sessionId: session.id,
            requestId,
            actorId: message.actorId,
            displayName: message.displayName.trim().slice(0, 80),
          });
          return;
        }
        leave();
        socketSession.set(socket, session);
        socketActorId.set(socket, message.actorId ?? randomUUID());
        const members = clients.get(session.id) ?? new Set<WebSocket>();
        members.add(socket);
        clients.set(session.id, members);
        broadcastPresence(session.id);
        send(socket, { type: 'session.snapshot', sessionId: session.id, snapshot: session.pageSnapshot });
        send(socket, { type: 'annotation.snapshot', sessionId: session.id, snapshot: session.annotationSnapshot });
        send(socket, { type: 'form.snapshot', sessionId: session.id, snapshot: session.formSnapshot });
        return;
      }
      const session = socketSession.get(socket);
      if (!session || session.id !== message.sessionId) {
        throw new RelayError('not-joined', '操作の前にセッションへ参加してください');
      }
      if (message.type === 'session.approve' || message.type === 'session.reject') {
        const pending = pendingJoins.get(message.requestId);
        if (!pending || pending.session.id !== session.id) {
          throw new RelayError('join-request-not-found', '参加申請が見つかりません');
        }
        pendingJoins.delete(message.requestId);
        clearTimeout(pending.expires);
        const decision = message.type === 'session.approve' ? 'approved' : 'rejected';
        broadcast(session.id, {
          type: 'session.join.resolved',
          sessionId: session.id,
          requestId: message.requestId,
          decision,
        });
        if (message.type === 'session.reject') {
          const cooldownKey = `${session.id}:${pending.actorId}`;
          const rejectionCount = (admissionCooldowns.get(cooldownKey)?.rejectionCount ?? 0) + 1;
          const retryAfterMs = rejectionCount * 5_000;
          admissionCooldowns.set(cooldownKey, {
            rejectionCount,
            retryAt: Date.now() + retryAfterMs,
          });
          send(pending.socket, {
            type: 'session.join.rejected',
            sessionId: session.id,
            requestId: message.requestId,
            retryAfterMs,
          });
          return;
        }
        admissionCooldowns.delete(`${session.id}:${pending.actorId}`);
        void store.issueMemberToken(session).then((memberToken) => {
          send(pending.socket, {
            type: 'session.join.approved',
            sessionId: session.id,
            requestId: message.requestId,
            memberToken,
          });
        }).catch((error: unknown) => reject(socket, error));
        return;
      }
      if (message.type === 'annotation.preview') {
        broadcast(session.id, {
          type: 'annotation.preview',
          sessionId: session.id,
          preview: message.preview,
        }, socket);
        return;
      }
      operationId = message.request.operationId;
      enqueue(session.id, async () => {
        let committed: ServerRelayMessage;
        if (message.type === 'page.operation') {
          const previous = session.pageSnapshot;
          const result = commitPageOperation(session.pageSnapshot, message.request);
          session.pageSnapshot = result.snapshot;
          committed = { type: 'page.committed', sessionId: session.id, committed: result.committed };
          try {
            await store.persist(session);
          } catch (error) {
            session.pageSnapshot = previous;
            throw error;
          }
        } else if (message.type === 'annotation.operation') {
          const previous = session.annotationSnapshot;
          const result = commitAnnotationOperation(session.annotationSnapshot, session.pageSnapshot.pages, message.request);
          session.annotationSnapshot = result.snapshot;
          committed = { type: 'annotation.committed', sessionId: session.id, committed: result.committed };
          try {
            await store.persist(session);
          } catch (error) {
            session.annotationSnapshot = previous;
            throw error;
          }
        } else {
          const previous = session.formSnapshot;
          const result = commitFormOperation(session.formSnapshot, session.pageSnapshot.pages, message.request);
          session.formSnapshot = result.snapshot;
          committed = { type: 'form.committed', sessionId: session.id, committed: result.committed };
          try {
            await store.persist(session);
          } catch (error) {
            session.formSnapshot = previous;
            throw error;
          }
        }
        broadcast(session.id, committed);
      }, (error) => reject(socket, error, operationId));
    } catch (error) {
      reject(socket, error, operationId);
    }
  });
});

httpServer.listen(port, host, () => {
  console.log(`pdfrx relay listening on http://${host}:${port}`);
  console.log(`API ${apiPrefix}, WebSocket ${relayPath}, data ${dataDirectory}`);
});

async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://relay.invalid');
  if (request.method === 'GET' && url.pathname === `${apiPrefix}/health`) {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && url.pathname === `${apiPrefix}/sessions`) {
    const bytes = await readBody(request);
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch {
      throw new HttpError(400, 'invalid-pdf');
    }
    let sessionName = '';
    try {
      sessionName = decodeURIComponent(header(request, 'x-pdfrx-session-name'));
    } catch {
      throw new HttpError(400, 'invalid-session-name');
    }
    const created = await store.create(sessionName, bytes, pdf.getPageCount());
    json(response, 201, { ...publicSession(created.session), memberToken: created.memberToken });
    return;
  }
  const sessionMatch = url.pathname.match(new RegExp(`^${escapeRegExp(apiPrefix)}/sessions/([^/]+)$`));
  if (request.method === 'GET' && sessionMatch) {
    const session = store.get(decodeURIComponent(sessionMatch[1]!));
    if (!session) throw new HttpError(404, 'session-not-found');
    json(response, 200, publicSession(session));
    return;
  }
  const sourceMatch = url.pathname.match(
    new RegExp(`^${escapeRegExp(apiPrefix)}/sessions/([^/]+)/sources/([^/]+)$`),
  );
  if (sourceMatch) {
    const session = authenticatedSession(request, decodeURIComponent(sourceMatch[1]!));
    const documentId = decodeURIComponent(sourceMatch[2]!);
    if (request.method === 'GET') {
      if (!await store.sourceExists(session.id, documentId)) return void json(response, 404, { error: 'source-not-found' });
      const bytes = await readFile(store.sourcePath(session.id, documentId));
      response.writeHead(200, {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/pdf',
        'Content-Length': bytes.byteLength,
      });
      response.end(bytes);
      return;
    }
    if (request.method === 'PUT') {
      let result: 'created' | 'existing';
      try {
        result = await store.putSource(session.id, documentId, await readBody(request));
      } catch (error) {
        if (error instanceof Error && error.message === 'source-conflict') {
          throw new HttpError(409, 'source-conflict');
        }
        throw error;
      }
      response.writeHead(result === 'created' ? 201 : 204).end();
      return;
    }
  }
  json(response, 404, { error: 'not-found' });
}

function authenticatedSession(request: IncomingMessage, id: string): StoredSession {
  const session = store.get(id);
  if (!session) throw new HttpError(404, 'session-not-found');
  if (!store.verifyMemberToken(session, decodedHeader(request, memberTokenHeader))) {
    throw new HttpError(401, 'authentication-failed');
  }
  return session;
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxSourceBytes) throw new HttpError(413, 'source-too-large');
    chunks.push(bytes);
  }
  if (size === 0) throw new HttpError(400, 'empty-body');
  return Buffer.concat(chunks);
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function decodedHeader(request: IncomingMessage, name: string): string {
  try {
    return decodeURIComponent(header(request, name));
  } catch {
    throw new HttpError(400, 'invalid-header');
  }
}

function publicSession(session: StoredSession): object {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    pageCount: session.pageSnapshot.pages.length,
  };
}

function json(response: ServerResponse, status: number, body: object): void {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  response.end(data);
}

function reject(socket: WebSocket, error: unknown, operationId?: string): void {
  const code = error instanceof PageProtocolError ||
    error instanceof AnnotationProtocolError ||
    error instanceof FormProtocolError ||
    error instanceof PageArrangementError ||
    error instanceof RelayError
    ? error.code
    : 'invalid-message';
  send(socket, {
    type: 'operation.rejected',
    operationId,
    code,
    message: error instanceof Error ? error.message : String(error),
  });
}

function normalizedPrefix(value: string): string {
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class RelayError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const client of webSockets.clients) client.close(1001, 'Server shutting down');
  httpServer.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
