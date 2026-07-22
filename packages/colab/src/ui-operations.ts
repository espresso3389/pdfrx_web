import type {
  PagePlacement,
  PagePlacementOperation,
  PagePlacementRotation,
} from '@pdfrx/viewer-core';

/** Creates an absolute rotation command from a relative clockwise delta. */
export function rotatePlacement(
  page: PagePlacement,
  delta: 90 | 180 | 270,
): PagePlacementOperation {
  return {
    type: 'page.rotate',
    placementId: page.placementId,
    rotation: ((page.rotation + delta) % 360) as PagePlacementRotation,
  };
}

/** Inserts an independently addressable copy immediately after the source placement. */
export function duplicatePlacement(page: PagePlacement, placementId: string): PagePlacementOperation {
  if (placementId.length === 0) throw new Error('placementId must not be empty');
  return {
    type: 'page.insert',
    page: { ...page, placementId },
    after: page.placementId,
  };
}

/**
 * Converts the thumbnail list's `(fromPageNumber, toIndex)` drop coordinates
 * into a stable placement-ID move. Returns `null` for an unchanged position.
 */
export function movePlacementToIndex(
  pages: readonly PagePlacement[],
  fromPageNumber: number,
  toIndex: number,
): PagePlacementOperation | null {
  const from = fromPageNumber - 1;
  if (!Number.isInteger(from) || from < 0 || from >= pages.length) {
    throw new RangeError(`fromPageNumber ${fromPageNumber} is out of range`);
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > pages.length) {
    throw new RangeError(`toIndex ${toIndex} is out of range`);
  }
  const moved = pages[from]!;
  const remaining = [...pages.slice(0, from), ...pages.slice(from + 1)];
  const insertionIndex = Math.min(toIndex > from ? toIndex - 1 : toIndex, remaining.length);
  if (insertionIndex === from) return null;
  const after = insertionIndex === 0 ? null : remaining[insertionIndex - 1]!.placementId;
  return { type: 'page.move', placementId: moved.placementId, after };
}

export function describePageOperation(operation: PagePlacementOperation): string {
  switch (operation.type) {
    case 'page.replace': return `文書を置換 (${operation.pages.length}ページ)`;
    case 'page.insert': return `ページを追加 (${operation.page.placementId.slice(0, 8)})`;
    case 'page.remove': return 'ページを削除';
    case 'page.move': return 'ページを並べ替え';
    case 'page.rotate': return `${operation.rotation}°に回転`;
  }
}
