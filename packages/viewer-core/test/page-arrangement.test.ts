import { describe, expect, it } from 'vitest';
import {
  applyPagePlacementOperation,
  applyPagePlacementOperations,
  PageArrangementError,
  validatePagePlacements,
  type PagePlacement,
} from '../src/index.js';

const page = (placementId: string, pageIndex: number, rotation: 0 | 90 | 180 | 270 = 0): PagePlacement => ({
  placementId,
  source: { documentId: 'main', pageIndex },
  rotation,
});

const ids = (pages: readonly PagePlacement[]): string[] => pages.map((item) => item.placementId);

describe('page arrangement operations', () => {
  it('inserts at the beginning or after a stable placement', () => {
    const original = [page('a', 0), page('c', 2)];
    const withB = applyPagePlacementOperation(original, {
      type: 'page.insert',
      page: page('b', 1),
      after: 'a',
    });
    const withStart = applyPagePlacementOperation(withB, {
      type: 'page.insert',
      page: page('start', 3),
      after: null,
    });

    expect(ids(original)).toEqual(['a', 'c']);
    expect(ids(withB)).toEqual(['a', 'b', 'c']);
    expect(ids(withStart)).toEqual(['start', 'a', 'b', 'c']);
  });

  it('replaces the complete arrangement atomically', () => {
    const replacement = [page('new-a', 4), page('new-b', 5, 90)];
    expect(applyPagePlacementOperation([page('old', 0)], {
      type: 'page.replace',
      pages: replacement,
    })).toEqual(replacement);
  });

  it('moves by placement identity after indices have changed', () => {
    const original = [page('a', 0), page('b', 1), page('c', 2), page('d', 3)];
    const moved = applyPagePlacementOperation(original, { type: 'page.move', placementId: 'b', after: 'c' });
    const first = applyPagePlacementOperation(moved, { type: 'page.move', placementId: 'd', after: null });

    expect(ids(moved)).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(first)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('rotates one placement without changing another copy of its source', () => {
    const original = [page('copy-1', 0), page('copy-2', 0)];
    const rotated = applyPagePlacementOperation(original, {
      type: 'page.rotate',
      placementId: 'copy-2',
      rotation: 90,
    });

    expect(rotated).toEqual([page('copy-1', 0), page('copy-2', 0, 90)]);
    expect(original[1]!.rotation).toBe(0);
  });

  it('returns the original array for moves and rotations that are already satisfied', () => {
    const original = [page('a', 0), page('b', 1)];
    expect(applyPagePlacementOperation(original, { type: 'page.move', placementId: 'a', after: null })).toBe(original);
    expect(applyPagePlacementOperation(original, { type: 'page.move', placementId: 'b', after: 'a' })).toBe(original);
    expect(applyPagePlacementOperation(original, { type: 'page.move', placementId: 'a', after: 'a' })).toBe(original);
    expect(applyPagePlacementOperation(original, { type: 'page.rotate', placementId: 'a', rotation: 0 })).toBe(original);
  });

  it('applies a committed sequence deterministically', () => {
    const result = applyPagePlacementOperations(
      [page('a', 0), page('b', 1)],
      [
        { type: 'page.insert', page: page('c', 2), after: 'b' },
        { type: 'page.rotate', placementId: 'c', rotation: 180 },
        { type: 'page.move', placementId: 'a', after: 'c' },
        { type: 'page.remove', placementId: 'b' },
      ],
    );

    expect(result).toEqual([page('c', 2, 180), page('a', 0)]);
  });
});

describe('page arrangement validation', () => {
  const expectCode = (run: () => unknown, code: PageArrangementError['code']): void => {
    try {
      run();
      throw new Error('Expected operation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PageArrangementError);
      expect((error as PageArrangementError).code).toBe(code);
    }
  };

  it('rejects duplicate placement IDs and invalid source fields', () => {
    expectCode(() => validatePagePlacements([page('same', 0), page('same', 1)]), 'duplicate-placement-id');
    expectCode(
      () => validatePagePlacements([{ ...page('bad', 0), source: { documentId: '', pageIndex: -1 } }]),
      'invalid-placement',
    );
  });

  it('rejects missing targets and anchors with stable error codes', () => {
    const original = [page('a', 0), page('b', 1)];
    expectCode(
      () => applyPagePlacementOperation(original, { type: 'page.remove', placementId: 'missing' }),
      'placement-not-found',
    );
    expectCode(
      () => applyPagePlacementOperation(original, { type: 'page.move', placementId: 'a', after: 'missing' }),
      'anchor-not-found',
    );
    expectCode(
      () => applyPagePlacementOperation(original, { type: 'page.insert', page: page('a', 2), after: null }),
      'duplicate-placement-id',
    );
  });

  it('keeps at least one page by default and permits an empty arrangement explicitly', () => {
    const original = [page('only', 0)];
    expectCode(
      () => applyPagePlacementOperation(original, { type: 'page.remove', placementId: 'only' }),
      'minimum-page-count',
    );
    expect(
      applyPagePlacementOperation(
        original,
        { type: 'page.remove', placementId: 'only' },
        { minimumPageCount: 0 },
      ),
    ).toEqual([]);
    expectCode(
      () => applyPagePlacementOperation(original, { type: 'page.replace', pages: [] }),
      'minimum-page-count',
    );
  });
});
