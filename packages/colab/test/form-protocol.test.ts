import { describe, expect, it } from 'vitest';
import { applyCommittedFormOperation, commitFormOperation, type FormSessionSnapshot } from '../src/form-protocol.js';
import type { PagePlacement } from '@pdfrx/viewer-core';

const pages: PagePlacement[] = [{
  placementId: 'page-1',
  source: { documentId: 'main', pageIndex: 0 },
  rotation: 0,
}];

describe('form collaboration protocol', () => {
  it('stores the latest typed value for each source field', () => {
    const initial: FormSessionSnapshot = { revision: 0, fields: [] };
    const first = commitFormOperation(initial, pages, {
      operationId: 'op-1', actorId: 'alice', baseRevision: 0,
      change: { documentId: 'main', fieldName: 'person.name', value: 'Alice' },
    });
    const second = commitFormOperation(first.snapshot, pages, {
      operationId: 'op-2', actorId: 'bob', baseRevision: 1,
      change: { documentId: 'main', fieldName: 'person.name', value: 'Bob' },
    });

    expect(second.snapshot).toEqual({
      revision: 2,
      fields: [{ documentId: 'main', fieldName: 'person.name', value: 'Bob' }],
    });
    expect(applyCommittedFormOperation(first.snapshot, second.committed)).toEqual(second.snapshot);
  });

  it('preserves checkbox and multi-select values', () => {
    let snapshot: FormSessionSnapshot = { revision: 0, fields: [] };
    for (const [fieldName, value] of [['accepted', true], ['colors', ['red', 'blue']]] as const) {
      snapshot = commitFormOperation(snapshot, pages, {
        operationId: fieldName,
        actorId: 'alice',
        baseRevision: snapshot.revision,
        change: { documentId: 'main', fieldName, value },
      }).snapshot;
    }
    expect(snapshot.fields.map((field) => field.value)).toEqual([true, ['red', 'blue']]);
  });
});
