import type { PagePlacement } from '@pdfrx/viewer-core';
import { describe, expect, it } from 'vitest';
import { duplicatePlacement, movePlacementToIndex, rotatePlacement } from '../src/ui-operations.js';

const page = (placementId: string, pageIndex: number, rotation: 0 | 90 | 180 | 270 = 0): PagePlacement => ({
  placementId,
  source: { documentId: 'main', pageIndex },
  rotation,
});

describe('collaboration UI operations', () => {
  it('rotates relative to the shared absolute state', () => {
    expect(rotatePlacement(page('a', 0, 270), 90)).toEqual({
      type: 'page.rotate', placementId: 'a', rotation: 0,
    });
    expect(rotatePlacement(page('a', 0, 90), 180)).toEqual({
      type: 'page.rotate', placementId: 'a', rotation: 270,
    });
  });

  it('duplicates source and rotation under a new placement identity', () => {
    expect(duplicatePlacement(page('a', 2, 90), 'copy')).toEqual({
      type: 'page.insert',
      page: page('copy', 2, 90),
      after: 'a',
    });
  });

  it('converts thumbnail drop indices to stable anchors', () => {
    const pages = [page('a', 0), page('b', 1), page('c', 2), page('d', 3)];
    expect(movePlacementToIndex(pages, 2, 4)).toEqual({ type: 'page.move', placementId: 'b', after: 'd' });
    expect(movePlacementToIndex(pages, 4, 0)).toEqual({ type: 'page.move', placementId: 'd', after: null });
    expect(movePlacementToIndex(pages, 2, 1)).toBeNull();
    expect(movePlacementToIndex(pages, 2, 2)).toBeNull();
  });
});
