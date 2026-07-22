import type { PdfFormFieldValue } from '@pdfrx/engine';
import type { PagePlacement } from '@pdfrx/viewer-core';

export interface SharedFormFieldChange {
  readonly documentId: string;
  readonly fieldName: string;
  readonly value: PdfFormFieldValue;
}

export interface SharedFormFieldRecord extends SharedFormFieldChange {}

export interface FormSessionSnapshot {
  readonly revision: number;
  readonly fields: readonly SharedFormFieldRecord[];
}

export interface FormOperationRequest {
  readonly operationId: string;
  readonly actorId: string;
  readonly baseRevision: number;
  readonly change: SharedFormFieldChange;
}

export interface CommittedFormOperation extends FormOperationRequest {
  readonly revision: number;
}

export function commitFormOperation(
  snapshot: FormSessionSnapshot,
  pages: readonly PagePlacement[],
  request: FormOperationRequest,
): { readonly snapshot: FormSessionSnapshot; readonly committed: CommittedFormOperation } {
  if (request.baseRevision !== snapshot.revision) {
    throw new FormProtocolError('form-revision-mismatch', `Expected form revision ${snapshot.revision}, got ${request.baseRevision}`);
  }
  if (!pages.some((page) => page.source.documentId === request.change.documentId)) {
    throw new FormProtocolError('document-not-found', `Document source not found: ${request.change.documentId}`);
  }
  const fields = snapshot.fields.filter(
    (field) => field.documentId !== request.change.documentId || field.fieldName !== request.change.fieldName,
  );
  fields.push(request.change);
  const revision = snapshot.revision + 1;
  return { snapshot: { revision, fields }, committed: { ...request, revision } };
}

export function applyCommittedFormOperation(
  snapshot: FormSessionSnapshot,
  committed: CommittedFormOperation,
): FormSessionSnapshot {
  if (committed.revision !== snapshot.revision + 1 || committed.baseRevision !== snapshot.revision) {
    throw new FormProtocolError('unexpected-form-revision', `Unexpected form revision ${committed.revision}`);
  }
  const fields = snapshot.fields.filter(
    (field) => field.documentId !== committed.change.documentId || field.fieldName !== committed.change.fieldName,
  );
  fields.push(committed.change);
  return { revision: committed.revision, fields };
}

export class FormProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'FormProtocolError';
  }
}
