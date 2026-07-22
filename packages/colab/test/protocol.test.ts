import type { PagePlacement } from '@pdfrx/viewer-core';
import { describe, expect, it } from 'vitest';
import {
  applyCommittedPageOperation,
  commitPageOperation,
  PageProtocolError,
  type PageSessionSnapshot,
} from '../src/index.js';

const page = (placementId: string, pageIndex: number): PagePlacement => ({
  placementId,
  source: { documentId: 'main', pageIndex },
  rotation: 0,
});

const initial = (): PageSessionSnapshot => ({ revision: 4, pages: [page('a', 0), page('b', 1)] });

describe('page operation protocol', () => {
  it('sequences a valid request and replays the committed event', () => {
    const request = {
      operationId: 'op-5',
      actorId: 'user-1',
      baseRevision: 4,
      operation: { type: 'page.rotate' as const, placementId: 'b', rotation: 90 as const },
    };
    const result = commitPageOperation(initial(), request);

    expect(result.committed).toEqual({ ...request, revision: 5 });
    expect(result.snapshot.revision).toBe(5);
    expect(result.snapshot.pages[1]!.rotation).toBe(90);
    expect(applyCommittedPageOperation(initial(), result.committed)).toEqual(result.snapshot);
  });

  it('commits a complete shared-document replacement in one revision', () => {
    const replacement = [page('replacement', 7)];
    const result = commitPageOperation(initial(), {
      operationId: 'replace-5',
      actorId: 'user-1',
      baseRevision: 4,
      operation: { type: 'page.replace', pages: replacement },
    });
    expect(result.snapshot).toEqual({ revision: 5, pages: replacement });
  });

  it('rejects a stale optimistic request', () => {
    expectCode(
      () => commitPageOperation(initial(), {
        operationId: 'stale',
        actorId: 'user-1',
        baseRevision: 3,
        operation: { type: 'page.remove', placementId: 'b' },
      }),
      'base-revision-mismatch',
    );
  });

  it('detects gaps and out-of-order replay', () => {
    expectCode(
      () => applyCommittedPageOperation(initial(), {
        operationId: 'op-6',
        actorId: 'user-2',
        baseRevision: 5,
        revision: 6,
        operation: { type: 'page.move', placementId: 'b', after: null },
      }),
      'unexpected-revision',
    );
  });

  it('rejects malformed operation envelopes', () => {
    expectCode(
      () => commitPageOperation(initial(), {
        operationId: '',
        actorId: 'user-1',
        baseRevision: 4,
        operation: { type: 'page.rotate', placementId: 'a', rotation: 90 },
      }),
      'invalid-envelope',
    );
  });
});

const expectCode = (run: () => unknown, code: PageProtocolError['code']): void => {
  try {
    run();
    throw new Error('Expected protocol failure');
  } catch (error) {
    expect(error).toBeInstanceOf(PageProtocolError);
    expect((error as PageProtocolError).code).toBe(code);
  }
};
