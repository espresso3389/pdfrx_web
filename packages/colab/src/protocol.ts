import {
  applyPagePlacementOperation,
  validatePagePlacements,
  type PagePlacement,
  type PagePlacementOperation,
} from '@pdfrx/viewer-core';

/**
 * Strict-revision page-arrangement protocol shared by collaboration clients
 * and authoritative relays.
 * @packageDocumentation
 */

/** Persisted or transferred authoritative page state. */
export interface PageSessionSnapshot {
  /** Last committed page-operation revision, starting at zero. */
  readonly revision: number;
  /** Complete ordered virtual-page arrangement at {@link revision}. */
  readonly pages: readonly PagePlacement[];
}

/** Optimistic command submitted by one client. */
export interface PageOperationRequest {
  /** Globally unique id used to correlate the eventual commit or rejection. */
  readonly operationId: string;
  /** Stable participant id responsible for the operation. */
  readonly actorId: string;
  /** Revision the participant observed when creating the operation. */
  readonly baseRevision: number;
  /** Intent expressed against stable placement ids rather than page numbers. */
  readonly operation: PagePlacementOperation;
}

/** Command accepted and sequenced by the authoritative relay. */
export interface CommittedPageOperation extends PageOperationRequest {
  /** Authoritative revision assigned to the accepted operation. */
  readonly revision: number;
}

/** Machine-readable failure categories produced by the strict page protocol. */
export type PageProtocolErrorCode =
  | 'invalid-envelope'
  | 'base-revision-mismatch'
  | 'unexpected-revision';

/** Error thrown for malformed, stale, or out-of-sequence page protocol data. */
export class PageProtocolError extends Error {
  /**
   * @param code Stable category suitable for relay error envelopes.
   * @param message Human-readable diagnostic text.
   */
  constructor(
    readonly code: PageProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageProtocolError';
  }
}

const assertRevision = (revision: number, field: string): void => {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new PageProtocolError('invalid-envelope', `${field} must be a non-negative safe integer`);
  }
};

const assertRequest = (request: PageOperationRequest): void => {
  if (request.operationId.length === 0 || request.actorId.length === 0) {
    throw new PageProtocolError('invalid-envelope', 'operationId and actorId must not be empty');
  }
  assertRevision(request.baseRevision, 'baseRevision');
};

/**
 * Validates revision and placement invariants in an authoritative snapshot.
 * @throws {@link PageProtocolError} for an invalid revision.
 * @throws `PageArrangementError` when placement identities or sources are invalid.
 */
export function validatePageSessionSnapshot(snapshot: PageSessionSnapshot): void {
  assertRevision(snapshot.revision, 'revision');
  validatePagePlacements(snapshot.pages);
}

/**
 * Authoritative-server transition. A stale optimistic command is rejected;
 * transformation/rebase policy can be layered above this strict primitive.
 *
 * @returns The next immutable snapshot and the corresponding sequenced event.
 * @throws {@link PageProtocolError} when the request is malformed or stale.
 */
export function commitPageOperation(
  snapshot: PageSessionSnapshot,
  request: PageOperationRequest,
): { readonly snapshot: PageSessionSnapshot; readonly committed: CommittedPageOperation } {
  validatePageSessionSnapshot(snapshot);
  assertRequest(request);
  if (request.baseRevision !== snapshot.revision) {
    throw new PageProtocolError(
      'base-revision-mismatch',
      `Expected base revision ${snapshot.revision}, got ${request.baseRevision}`,
    );
  }
  const revision = snapshot.revision + 1;
  const pages = applyPagePlacementOperation(snapshot.pages, request.operation);
  return {
    snapshot: { revision, pages },
    committed: { ...request, revision },
  };
}

/**
 * Applies the next relay event on a client or while replaying an operation log.
 * @throws {@link PageProtocolError} if the event does not immediately follow the snapshot.
 */
export function applyCommittedPageOperation(
  snapshot: PageSessionSnapshot,
  committed: CommittedPageOperation,
): PageSessionSnapshot {
  validatePageSessionSnapshot(snapshot);
  assertRequest(committed);
  assertRevision(committed.revision, 'revision');
  const expected = snapshot.revision + 1;
  if (committed.revision !== expected || committed.baseRevision !== snapshot.revision) {
    throw new PageProtocolError(
      'unexpected-revision',
      `Expected revision ${expected} based on ${snapshot.revision}, got ${committed.revision} based on ${committed.baseRevision}`,
    );
  }
  return {
    revision: committed.revision,
    pages: applyPagePlacementOperation(snapshot.pages, committed.operation),
  };
}
