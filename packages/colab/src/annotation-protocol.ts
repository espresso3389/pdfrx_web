import type { PdfAnnotationSpec } from '@pdfrx/engine';
import type { PagePlacement } from '@pdfrx/viewer-core';

export type SharedAnnotationChange =
  | { readonly type: 'add' | 'update'; readonly placementId: string; readonly id: string; readonly spec: PdfAnnotationSpec }
  | { readonly type: 'remove'; readonly placementId: string; readonly id: string };

export interface SharedAnnotationRecord {
  readonly placementId: string;
  readonly id: string;
  readonly spec: PdfAnnotationSpec;
}

export interface AnnotationSessionSnapshot {
  readonly revision: number;
  readonly annotations: readonly SharedAnnotationRecord[];
}

export interface AnnotationOperationRequest {
  readonly operationId: string;
  readonly actorId: string;
  readonly baseRevision: number;
  readonly change: SharedAnnotationChange;
}

export interface CommittedAnnotationOperation extends AnnotationOperationRequest {
  readonly revision: number;
}

export function commitAnnotationOperation(
  snapshot: AnnotationSessionSnapshot,
  pages: readonly PagePlacement[],
  request: AnnotationOperationRequest,
): { readonly snapshot: AnnotationSessionSnapshot; readonly committed: CommittedAnnotationOperation } {
  if (request.baseRevision !== snapshot.revision) {
    throw new AnnotationProtocolError('annotation-revision-mismatch', `Expected annotation revision ${snapshot.revision}, got ${request.baseRevision}`);
  }
  if (!pages.some((page) => page.placementId === request.change.placementId)) {
    throw new AnnotationProtocolError('placement-not-found', `Page placement not found: ${request.change.placementId}`);
  }
  const annotations = snapshot.annotations.filter(
    (item) => item.placementId !== request.change.placementId || item.id !== request.change.id,
  );
  if (request.change.type !== 'remove') {
    annotations.push({ placementId: request.change.placementId, id: request.change.id, spec: request.change.spec });
  }
  const revision = snapshot.revision + 1;
  return { snapshot: { revision, annotations }, committed: { ...request, revision } };
}

export function applyCommittedAnnotationOperation(
  snapshot: AnnotationSessionSnapshot,
  committed: CommittedAnnotationOperation,
): AnnotationSessionSnapshot {
  if (committed.revision !== snapshot.revision + 1 || committed.baseRevision !== snapshot.revision) {
    throw new AnnotationProtocolError('unexpected-annotation-revision', `Unexpected annotation revision ${committed.revision}`);
  }
  const annotations = snapshot.annotations.filter(
    (item) => item.placementId !== committed.change.placementId || item.id !== committed.change.id,
  );
  if (committed.change.type !== 'remove') {
    annotations.push({ placementId: committed.change.placementId, id: committed.change.id, spec: committed.change.spec });
  }
  return { revision: committed.revision, annotations };
}

export class AnnotationProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AnnotationProtocolError';
  }
}
