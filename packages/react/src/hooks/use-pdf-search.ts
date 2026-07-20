import type { SearchMatch, StartTextSearchOptions } from '@pdfrx/viewer';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { usePdfrxStore } from '../context.js';
import { shallowEqual, useViewerSnapshot } from './use-viewer-snapshot.js';

/** Search state and actions returned by {@link usePdfSearch}. */
export interface PdfSearch {
  /** The current search text. Bind this to your input's `value`. */
  query: string;
  /** Sets the search text and (re)starts the search. Debounced by 500 ms unless told otherwise. */
  setQuery: (query: string, options?: StartTextSearchOptions & { force?: boolean }) => void;
  /** Every match found so far, in page then in-page order. Grows while scanning. */
  matches: readonly SearchMatch[];
  /** Total number of matches found so far. */
  matchCount: number;
  /** Index of the active match within {@link matches}, or `null`. */
  currentIndex: number | null;
  /** The active match, or `null`. */
  currentMatch: SearchMatch | null;
  /** Whether pages are still being scanned. */
  isSearching: boolean;
  /** Scan progress in `[0, 1]`, or `null` before a search starts. */
  progress: number | null;
  /** Scrolls to the previous match. Does not wrap past the first one. */
  goToPrevious: () => Promise<number>;
  /** Scrolls to the next match. Does not wrap past the last one. */
  goToNext: () => Promise<number>;
  /** Scrolls to a match by index. Returns `-1` if the index is out of range. */
  goToMatch: (index: number) => Promise<number>;
  /** Clears the query, the matches and the painted highlights. */
  reset: () => void;
}

/**
 * Full-text search over the document, with highlights painted by the viewer.
 *
 * There is one searcher per viewer — the provider owns it — so several
 * components can call this hook and stay in sync. It is reset automatically
 * when a different document is opened.
 *
 * @example
 * ```tsx
 * const { query, setQuery, currentIndex, matchCount, goToNext } = usePdfSearch();
 * return (
 *   <>
 *     <input value={query} onChange={(e) => setQuery(e.target.value)} />
 *     <span>{(currentIndex ?? -1) + 1} / {matchCount}</span>
 *     <button onClick={() => void goToNext()}>Next</button>
 *   </>
 * );
 * ```
 */
export function usePdfSearch(): PdfSearch {
  const store = usePdfrxStore();

  const query = useSyncExternalStore(store.subscribe, store.getSearchQuery, store.getSearchQuery);

  // The searcher notifies on every page it finishes scanning, on current-match
  // changes and on resets — the same moments the viewer repaints highlights.
  const state = useViewerSnapshot(
    // useViewerSnapshot re-runs this whenever the store notifies, which covers
    // the document change that swaps the searcher out from under us.
    (_viewer, onChange) => store.searcher?.addListener(onChange) ?? (() => {}),
    () => {
      const searcher = store.searcher;
      return {
        matches: (searcher?.matches ?? EMPTY_MATCHES) as readonly SearchMatch[],
        matchCount: searcher?.matches.length ?? 0,
        currentIndex: searcher?.currentIndex ?? null,
        currentMatch: searcher?.currentMatch ?? null,
        isSearching: searcher?.isSearching ?? false,
        progress: searcher?.searchProgress ?? null,
      };
    },
    shallowEqual,
  );

  const setQuery = useCallback(
    (next: string, options?: StartTextSearchOptions & { force?: boolean }) => store.setSearchQuery(next, options),
    [store],
  );
  const goToPrevious = useCallback(async () => (await store.searcher?.goToPrevMatch()) ?? -1, [store]);
  const goToNext = useCallback(async () => (await store.searcher?.goToNextMatch()) ?? -1, [store]);
  const goToMatch = useCallback(async (index: number) => (await store.searcher?.goToMatchOfIndex(index)) ?? -1, [store]);
  const reset = useCallback(() => store.setSearchQuery('', { force: true }), [store]);

  return useMemo(
    () => ({ query, setQuery, ...state, goToPrevious, goToNext, goToMatch, reset }),
    [query, setQuery, state, goToPrevious, goToNext, goToMatch, reset],
  );
}

const EMPTY_MATCHES: readonly SearchMatch[] = [];
