import type { PdfDest } from '@pdfrx/engine';
import type { PdfRect } from '@pdfrx/viewer';
import { useCallback, useMemo } from 'react';
import { usePdfrxStore } from '../context.js';
import { shallowEqual, useViewerSnapshot } from './use-viewer-snapshot.js';

/** Navigation state and actions returned by {@link usePdfNavigation}. */
export interface PdfNavigation {
  /** The most-visible page (1-based), or `null` when no document is shown. */
  currentPageNumber: number | null;
  /** Number of pages, or `0` when nothing is open. */
  pageCount: number;
  /** Whether {@link goToPreviousPage} would do anything. */
  canGoPrevious: boolean;
  /** Whether {@link goToNextPage} would do anything. */
  canGoNext: boolean;
  /** Scrolls to a 1-based page number, fitting it in the viewport. */
  goToPage: (pageNumber: number, duration?: number) => void;
  goToPreviousPage: (duration?: number) => void;
  goToNextPage: (duration?: number) => void;
  /** Follows an outline/link destination. Falls back to the page when the dest has no view. */
  goToDest: (dest: PdfDest | null, duration?: number) => void;
  /** Scrolls the minimum amount to bring a rect on a page into view, keeping the zoom. */
  ensureVisiblePageRect: (pageNumber: number, rect: PdfRect, margin?: number) => void;
}

/**
 * Current page, page count and the ways to move between them.
 *
 * Re-renders when the current page changes (as the user scrolls) and when a
 * document is loaded or its pages are rearranged.
 *
 * @example
 * ```tsx
 * const { currentPageNumber, pageCount, goToNextPage, canGoNext } = usePdfNavigation();
 * return (
 *   <>
 *     <span>{currentPageNumber} / {pageCount}</span>
 *     <button onClick={() => goToNextPage(200)} disabled={!canGoNext}>Next</button>
 *   </>
 * );
 * ```
 */
export function usePdfNavigation(): PdfNavigation {
  const store = usePdfrxStore();

  const state = useViewerSnapshot(
    (viewer, onChange) => {
      const offPage = viewer.addPageChangeListener(onChange);
      const offDocument = viewer.addDocumentChangeListener(onChange);
      return () => {
        offPage();
        offDocument();
      };
    },
    (viewer) => ({
      currentPageNumber: viewer?.currentPageNumber ?? null,
      pageCount: viewer?.pageCount ?? 0,
    }),
    shallowEqual,
  );

  const goToPage = useCallback(
    (pageNumber: number, duration?: number) => store.viewer?.goToPage(pageNumber, duration),
    [store],
  );
  const goToDest = useCallback(
    (dest: PdfDest | null, duration?: number) => store.viewer?.goToDest(dest, duration),
    [store],
  );
  const ensureVisiblePageRect = useCallback(
    (pageNumber: number, rect: PdfRect, margin?: number) =>
      store.viewer?.ensureVisiblePageRect(pageNumber, rect, margin),
    [store],
  );

  return useMemo(() => {
    const { currentPageNumber, pageCount } = state;
    const current = currentPageNumber ?? 0;
    return {
      currentPageNumber,
      pageCount,
      canGoPrevious: current > 1,
      canGoNext: current > 0 && current < pageCount,
      goToPage,
      goToPreviousPage: (duration?: number) => {
        if (current > 1) goToPage(current - 1, duration);
      },
      goToNextPage: (duration?: number) => {
        if (current > 0 && current < pageCount) goToPage(current + 1, duration);
      },
      goToDest,
      ensureVisiblePageRect,
    };
  }, [state, goToPage, goToDest, ensureVisiblePageRect]);
}
