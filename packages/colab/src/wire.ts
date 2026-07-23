import type { PagePlacementOperation } from '@pdfrx/viewer-core';
import type { CommittedPageOperation, PageOperationRequest, PageSessionSnapshot } from './protocol.js';
import type {
  AnnotationOperationRequest,
  AnnotationPreview,
  AnnotationSessionSnapshot,
  CommittedAnnotationOperation,
  SharedAnnotationChange,
} from './annotation-protocol.js';
import type {
  CommittedFormOperation,
  FormOperationRequest,
  FormSessionSnapshot,
  SharedFormFieldChange,
} from './form-protocol.js';

/** Messages accepted from a browser client by the reference relay. */
export type ClientRelayMessage =
  | {
      readonly type: 'session.join';
      readonly sessionId: string;
      readonly memberToken?: string;
      readonly actorId?: string;
      readonly displayName?: string;
    }
  | { readonly type: 'session.approve'; readonly sessionId: string; readonly requestId: string }
  | { readonly type: 'session.reject'; readonly sessionId: string; readonly requestId: string }
  | { readonly type: 'page.operation'; readonly sessionId: string; readonly request: PageOperationRequest }
  | { readonly type: 'annotation.operation'; readonly sessionId: string; readonly request: AnnotationOperationRequest }
  | { readonly type: 'annotation.preview'; readonly sessionId: string; readonly preview: AnnotationPreview }
  | { readonly type: 'form.operation'; readonly sessionId: string; readonly request: FormOperationRequest };

/** Snapshots, commits, and structured errors emitted by the reference relay. */
export type ServerRelayMessage =
  | { readonly type: 'session.snapshot'; readonly sessionId: string; readonly snapshot: PageSessionSnapshot }
  | { readonly type: 'annotation.snapshot'; readonly sessionId: string; readonly snapshot: AnnotationSessionSnapshot }
  | { readonly type: 'form.snapshot'; readonly sessionId: string; readonly snapshot: FormSessionSnapshot }
  | { readonly type: 'session.presence'; readonly sessionId: string; readonly connectedCount: number }
  | { readonly type: 'page.committed'; readonly sessionId: string; readonly committed: CommittedPageOperation }
  | { readonly type: 'annotation.committed'; readonly sessionId: string; readonly committed: CommittedAnnotationOperation }
  | { readonly type: 'annotation.preview'; readonly sessionId: string; readonly preview: AnnotationPreview }
  | { readonly type: 'form.committed'; readonly sessionId: string; readonly committed: CommittedFormOperation }
  | {
      readonly type: 'session.join.pending';
      readonly sessionId: string;
      readonly requestId: string;
    }
  | {
      readonly type: 'session.join.request';
      readonly sessionId: string;
      readonly requestId: string;
      readonly actorId: string;
      readonly displayName: string;
    }
  | {
      readonly type: 'session.join.approved';
      readonly sessionId: string;
      readonly requestId: string;
      readonly memberToken: string;
    }
  | {
      readonly type: 'session.join.rejected';
      readonly sessionId: string;
      readonly requestId: string;
      readonly retryAfterMs: number;
    }
  | {
      readonly type: 'session.join.resolved';
      readonly sessionId: string;
      readonly requestId: string;
      readonly decision: 'approved' | 'rejected' | 'cancelled';
    }
  | {
      readonly type: 'operation.rejected';
      readonly sessionId?: string;
      readonly operationId?: string;
      readonly code: string;
      readonly message: string;
      readonly currentRevision?: number;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isRotation = (value: unknown): value is 0 | 90 | 180 | 270 =>
  value === 0 || value === 90 || value === 180 || value === 270;

const parseOperation = (value: unknown): PagePlacementOperation => {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Invalid page operation');
  switch (value.type) {
    case 'page.replace': {
      if (!Array.isArray(value.pages)) throw new Error('Invalid page.replace operation');
      const pages = value.pages.map((page) => {
        if (
          !isRecord(page) || !isString(page.placementId) || !isRecord(page.source) ||
          !isString(page.source.documentId) || !Number.isSafeInteger(page.source.pageIndex) ||
          (page.source.pageIndex as number) < 0 || !isRotation(page.rotation)
        ) throw new Error('Invalid page.replace operation');
        return {
          placementId: page.placementId,
          source: { documentId: page.source.documentId, pageIndex: page.source.pageIndex as number },
          rotation: page.rotation,
        };
      });
      return { type: 'page.replace', pages };
    }
    case 'page.insert': {
      const page = value.page;
      if (
        !isRecord(page) || !isString(page.placementId) || !isRecord(page.source) ||
        !isString(page.source.documentId) || !Number.isSafeInteger(page.source.pageIndex) ||
        (page.source.pageIndex as number) < 0 || !isRotation(page.rotation) ||
        !(value.after === null || isString(value.after))
      ) throw new Error('Invalid page.insert operation');
      return {
        type: 'page.insert',
        page: {
          placementId: page.placementId,
          source: { documentId: page.source.documentId, pageIndex: page.source.pageIndex as number },
          rotation: page.rotation,
        },
        after: value.after,
      };
    }
    case 'page.remove':
      if (!isString(value.placementId)) throw new Error('Invalid page.remove operation');
      return { type: 'page.remove', placementId: value.placementId };
    case 'page.move':
      if (!isString(value.placementId) || !(value.after === null || isString(value.after))) {
        throw new Error('Invalid page.move operation');
      }
      return { type: 'page.move', placementId: value.placementId, after: value.after };
    case 'page.rotate':
      if (!isString(value.placementId) || !isRotation(value.rotation)) {
        throw new Error('Invalid page.rotate operation');
      }
      return { type: 'page.rotate', placementId: value.placementId, rotation: value.rotation };
    default:
      throw new Error(`Unknown page operation: ${value.type}`);
  }
};

const parseRequest = (value: unknown): PageOperationRequest => {
  if (
    !isRecord(value) || !isString(value.operationId) || !isString(value.actorId) ||
    !Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0
  ) throw new Error('Invalid page operation request');
  return {
    operationId: value.operationId,
    actorId: value.actorId,
    baseRevision: value.baseRevision as number,
    operation: parseOperation(value.operation),
  };
};

const parseAnnotationChange = (value: unknown): SharedAnnotationChange => {
  if (!isRecord(value) || !isString(value.type) || !isString(value.placementId) || !isString(value.id)) {
    throw new Error('Invalid annotation change');
  }
  if (value.type === 'remove') return { type: 'remove', placementId: value.placementId, id: value.id };
  if ((value.type === 'add' || value.type === 'update') && isRecord(value.spec) && isString(value.spec.subtype)) {
    return { type: value.type, placementId: value.placementId, id: value.id, spec: value.spec as never };
  }
  throw new Error('Invalid annotation change');
};

const parseAnnotationRequest = (value: unknown): AnnotationOperationRequest => {
  if (
    !isRecord(value) || !isString(value.operationId) || !isString(value.actorId) ||
    !Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0
  ) throw new Error('Invalid annotation operation request');
  return {
    operationId: value.operationId,
    actorId: value.actorId,
    baseRevision: value.baseRevision as number,
    change: parseAnnotationChange(value.change),
  };
};

const isFormValue = (value: unknown): value is SharedFormFieldChange['value'] =>
  typeof value === 'string' || typeof value === 'boolean' ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));

const parseFormRequest = (value: unknown): FormOperationRequest => {
  if (
    !isRecord(value) || !isString(value.operationId) || !isString(value.actorId) ||
    !Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0 ||
    !isRecord(value.change) || !isString(value.change.documentId) ||
    !isString(value.change.fieldName) || !isFormValue(value.change.value)
  ) throw new Error('Invalid form operation request');
  return {
    operationId: value.operationId,
    actorId: value.actorId,
    baseRevision: value.baseRevision as number,
    change: {
      documentId: value.change.documentId,
      fieldName: value.change.fieldName,
      value: value.change.value,
    },
  };
};

/**
 * Parses and validates one untrusted client WebSocket payload.
 * @throws `Error` for malformed JSON, envelopes, or operations.
 */
export function parseClientRelayMessage(json: string): ClientRelayMessage {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || !isString(value.type) || !isString(value.sessionId)) {
    throw new Error('Invalid relay message');
  }
  if (value.type === 'session.join') {
    if (
      (value.memberToken !== undefined && typeof value.memberToken !== 'string') ||
      (value.actorId !== undefined && typeof value.actorId !== 'string') ||
      (value.displayName !== undefined && typeof value.displayName !== 'string')
    ) {
      throw new Error('Invalid session join');
    }
    return {
      type: value.type,
      sessionId: value.sessionId,
      ...(typeof value.memberToken === 'string' ? { memberToken: value.memberToken } : {}),
      ...(typeof value.actorId === 'string' ? { actorId: value.actorId } : {}),
      ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    };
  }
  if (value.type === 'session.approve' || value.type === 'session.reject') {
    if (!isString(value.requestId)) throw new Error('Invalid session approval');
    return { type: value.type, sessionId: value.sessionId, requestId: value.requestId };
  }
  if (value.type === 'page.operation') {
    return { type: value.type, sessionId: value.sessionId, request: parseRequest(value.request) };
  }
  if (value.type === 'annotation.operation') {
    return { type: value.type, sessionId: value.sessionId, request: parseAnnotationRequest(value.request) };
  }
  if (value.type === 'annotation.preview') {
    if (!isRecord(value.preview) || !isString(value.preview.actorId) || !Array.isArray(value.preview.changes)) {
      throw new Error('Invalid annotation preview');
    }
    const changes = value.preview.changes.map(parseAnnotationChange);
    if (changes.some((change) => change.type !== 'update')) throw new Error('Invalid annotation preview');
    return {
      type: value.type,
      sessionId: value.sessionId,
      preview: { actorId: value.preview.actorId, changes: changes as AnnotationPreview['changes'] },
    };
  }
  if (value.type === 'form.operation') {
    return { type: value.type, sessionId: value.sessionId, request: parseFormRequest(value.request) };
  }
  throw new Error(`Unknown relay message: ${value.type}`);
}

/**
 * Parses and validates one untrusted relay payload before changing client state.
 * @throws `Error` for malformed JSON, snapshots, commits, or errors.
 */
export function parseServerRelayMessage(json: string): ServerRelayMessage {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Invalid server relay message');
  // Server messages are produced by our relay. Keep this parser intentionally
  // shallow; the protocol reducers validate snapshots and committed operations.
  return value as ServerRelayMessage;
}
