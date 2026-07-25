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

  it('merges compact geometry updates with an out-of-band image reference', () => {
    const imageSpec = {
      ...spec,
      appearanceImageSource: {
        documentId: 'annotation-image-1',
        width: 320,
        height: 200,
      },
    };
    const snapshot = {
      revision: 1,
      annotations: [{ placementId: 'page-a', id: 'image-1', spec: imageSpec }],
    };
    const result = commitAnnotationOperation(snapshot, pages, {
      operationId: 'move-image',
      actorId: 'alice',
      baseRevision: 1,
      change: {
        type: 'update',
        placementId: 'page-a',
        id: 'image-1',
        spec: { ...spec, rect: { left: 20, bottom: 20, right: 50, top: 50 } },
      },
    });

    expect(result.committed.change.type === 'update' && result.committed.change.spec.appearanceImageSource).toBeUndefined();
    expect(result.snapshot.annotations[0]?.spec).toMatchObject({
      rect: { left: 20, bottom: 20, right: 50, top: 50 },
      appearanceImageSource: imageSpec.appearanceImageSource,
    });
    expect(applyCommittedAnnotationOperation(snapshot, result.committed)).toEqual(result.snapshot);
  });
});
