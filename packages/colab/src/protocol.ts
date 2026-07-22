import {
  applyPagePlacementOperation,
  validatePagePlacements,
  type PagePlacement,
  type PagePlacementOperation,
} from '@pdfrx/viewer-core';

/** Persisted or transferred authoritative page state. */
export interface PageSessionSnapshot {
  readonly revision: number;
  readonly pages: readonly PagePlacement[];
}

/** Optimistic command submitted by one client. */
export interface PageOperationRequest {
  readonly operationId: string;
  readonly actorId: string;
  readonly baseRevision: number;
  readonly operation: PagePlacementOperation;
}

/** Command accepted and sequenced by the authoritative relay. */
export interface CommittedPageOperation extends PageOperationRequest {
  readonly revision: number;
}

export type PageProtocolErrorCode =
  | 'invalid-envelope'
  | 'base-revision-mismatch'
  | 'unexpected-revision';

export class PageProtocolError extends Error {
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

export function validatePageSessionSnapshot(snapshot: PageSessionSnapshot): void {
  assertRevision(snapshot.revision, 'revision');
  validatePagePlacements(snapshot.pages);
}

/**
 * Authoritative-server transition. A stale optimistic command is rejected;
 * transformation/rebase policy can be layered above this strict primitive.
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

/** Applies the next relay event on a client or while replaying an operation log. */
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
