/** Clockwise page rotation supported by PDF page arrangements. */
export type PagePlacementRotation = 0 | 90 | 180 | 270;

/** Immutable identity of the PDF page content used by a placement. */
export interface PagePlacementSource {
  /** Application/session identity of an uploaded source PDF. */
  readonly documentId: string;
  /** Zero-based physical page index in the source PDF. */
  readonly pageIndex: number;
}

/** One independently addressable slot in a shared page arrangement. */
export interface PagePlacement {
  /** Stable identity of this slot. Duplicates of one source page need distinct IDs. */
  readonly placementId: string;
  readonly source: PagePlacementSource;
  readonly rotation: PagePlacementRotation;
}

/** A network-independent page-arrangement command. */
export type PagePlacementOperation =
  | { readonly type: 'page.insert'; readonly page: PagePlacement; readonly after: string | null }
  | { readonly type: 'page.replace'; readonly pages: readonly PagePlacement[] }
  | { readonly type: 'page.remove'; readonly placementId: string }
  | { readonly type: 'page.move'; readonly placementId: string; readonly after: string | null }
  | { readonly type: 'page.rotate'; readonly placementId: string; readonly rotation: PagePlacementRotation };

/** Stable failure categories suitable for validation responses at an application boundary. */
export type PageArrangementErrorCode =
  | 'duplicate-placement-id'
  | 'invalid-placement'
  | 'placement-not-found'
  | 'anchor-not-found'
  | 'minimum-page-count';

/** Validation failure produced while applying a page-arrangement command. */
export class PageArrangementError extends Error {
  constructor(
    readonly code: PageArrangementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageArrangementError';
  }
}

/** Options controlling arrangement invariants. */
export interface ApplyPagePlacementOptions {
  /** Minimum number of pages that must remain. Defaults to 1. */
  readonly minimumPageCount?: number;
}

const rotations = new Set<PagePlacementRotation>([0, 90, 180, 270]);

const assertPlacement = (page: PagePlacement): void => {
  if (
    page.placementId.length === 0 ||
    page.source.documentId.length === 0 ||
    !Number.isInteger(page.source.pageIndex) ||
    page.source.pageIndex < 0 ||
    !rotations.has(page.rotation)
  ) {
    throw new PageArrangementError('invalid-placement', `Invalid page placement ${JSON.stringify(page)}`);
  }
};

/** Validates placement fields and uniqueness without changing the arrangement. */
export function validatePagePlacements(pages: readonly PagePlacement[]): void {
  const ids = new Set<string>();
  for (const page of pages) {
    assertPlacement(page);
    if (ids.has(page.placementId)) {
      throw new PageArrangementError('duplicate-placement-id', `Duplicate placement id: ${page.placementId}`);
    }
    ids.add(page.placementId);
  }
}

const indexAfter = (pages: readonly PagePlacement[], after: string | null): number => {
  if (after === null) return 0;
  const anchorIndex = pages.findIndex((page) => page.placementId === after);
  if (anchorIndex < 0) throw new PageArrangementError('anchor-not-found', `Anchor placement not found: ${after}`);
  return anchorIndex + 1;
};

const placementIndex = (pages: readonly PagePlacement[], placementId: string): number => {
  const index = pages.findIndex((page) => page.placementId === placementId);
  if (index < 0) {
    throw new PageArrangementError('placement-not-found', `Page placement not found: ${placementId}`);
  }
  return index;
};

/**
 * Applies one page command and returns a new arrangement. Inputs are never
 * mutated. An operation that already has its requested result returns the
 * original array, which lets stores avoid a redundant notification.
 */
export function applyPagePlacementOperation(
  pages: readonly PagePlacement[],
  operation: PagePlacementOperation,
  options: ApplyPagePlacementOptions = {},
): readonly PagePlacement[] {
  validatePagePlacements(pages);
  const minimumPageCount = options.minimumPageCount ?? 1;
  if (!Number.isInteger(minimumPageCount) || minimumPageCount < 0) {
    throw new RangeError(`minimumPageCount must be a non-negative integer, got ${minimumPageCount}`);
  }

  switch (operation.type) {
    case 'page.replace': {
      validatePagePlacements(operation.pages);
      if (operation.pages.length < minimumPageCount) {
        throw new PageArrangementError(
          'minimum-page-count',
          `Replacing the document would leave fewer than ${minimumPageCount} pages`,
        );
      }
      return operation.pages.slice();
    }
    case 'page.insert': {
      assertPlacement(operation.page);
      if (pages.some((page) => page.placementId === operation.page.placementId)) {
        throw new PageArrangementError(
          'duplicate-placement-id',
          `Duplicate placement id: ${operation.page.placementId}`,
        );
      }
      const at = indexAfter(pages, operation.after);
      return [...pages.slice(0, at), operation.page, ...pages.slice(at)];
    }
    case 'page.remove': {
      const at = placementIndex(pages, operation.placementId);
      if (pages.length - 1 < minimumPageCount) {
        throw new PageArrangementError(
          'minimum-page-count',
          `Removing ${operation.placementId} would leave fewer than ${minimumPageCount} pages`,
        );
      }
      return [...pages.slice(0, at), ...pages.slice(at + 1)];
    }
    case 'page.move': {
      const from = placementIndex(pages, operation.placementId);
      if (operation.after === operation.placementId) return pages;
      const without = [...pages.slice(0, from), ...pages.slice(from + 1)];
      const to = indexAfter(without, operation.after);
      if (to === from) return pages;
      const moved = pages[from]!;
      return [...without.slice(0, to), moved, ...without.slice(to)];
    }
    case 'page.rotate': {
      if (!rotations.has(operation.rotation)) {
        throw new PageArrangementError('invalid-placement', `Invalid page rotation: ${operation.rotation}`);
      }
      const at = placementIndex(pages, operation.placementId);
      const current = pages[at]!;
      if (current.rotation === operation.rotation) return pages;
      const next = pages.slice();
      next[at] = { ...current, rotation: operation.rotation };
      return next;
    }
  }
}

/** Applies a committed command sequence in order; the original array remains unchanged if one fails. */
export function applyPagePlacementOperations(
  pages: readonly PagePlacement[],
  operations: readonly PagePlacementOperation[],
  options: ApplyPagePlacementOptions = {},
): readonly PagePlacement[] {
  let result = pages;
  for (const operation of operations) result = applyPagePlacementOperation(result, operation, options);
  return result;
}
