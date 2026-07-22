import { describe, expect, it } from 'vitest';
import type { PagePlacement } from '@pdfrx/viewer-core';
import { applyCommittedAnnotationOperation, commitAnnotationOperation } from '../src/annotation-protocol.js';

const pages: PagePlacement[] = [{
  placementId: 'page-a',
  source: { documentId: 'main', pageIndex: 0 },
  rotation: 0,
}];
const spec = { subtype: 'square' as const, rect: { left: 10, bottom: 10, right: 40, top: 40 } };

describe('annotation collaboration protocol', () => {
  it('upserts and removes annotations addressed by placement id', () => {
    const added = commitAnnotationOperation({ revision: 0, annotations: [] }, pages, {
      operationId: 'op-1', actorId: 'alice', baseRevision: 0,
      change: { type: 'add', placementId: 'page-a', id: 'note-1', spec },
    });
    expect(added.snapshot).toEqual({
      revision: 1,
      annotations: [{ placementId: 'page-a', id: 'note-1', spec }],
    });
    expect(applyCommittedAnnotationOperation({ revision: 0, annotations: [] }, added.committed)).toEqual(added.snapshot);

    const removed = commitAnnotationOperation(added.snapshot, pages, {
      operationId: 'op-2', actorId: 'bob', baseRevision: 1,
      change: { type: 'remove', placementId: 'page-a', id: 'note-1' },
    });
    expect(removed.snapshot).toEqual({ revision: 2, annotations: [] });
  });

  it('rejects stale revisions and missing placements', () => {
    const snapshot = { revision: 2, annotations: [] };
    expect(() => commitAnnotationOperation(snapshot, pages, {
      operationId: 'stale', actorId: 'alice', baseRevision: 1,
      change: { type: 'add', placementId: 'page-a', id: 'a', spec },
    })).toThrow('Expected annotation revision 2');
    expect(() => commitAnnotationOperation(snapshot, pages, {
      operationId: 'missing', actorId: 'alice', baseRevision: 2,
      change: { type: 'add', placementId: 'missing', id: 'a', spec },
    })).toThrow('Page placement not found');
  });
});
