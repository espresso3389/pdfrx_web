import type { PdfDocumentEventMap } from '@pdfrx/engine';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { usePdfrxViewer } from './use-pdfrx-viewer.js';
import { usePdfrxStore } from '../context.js';

/**
 * A counter that increments on every document change — including the automatic
 * reopen the viewer performs after registering missing-font fallbacks.
 *
 * Use it as an effect dependency or a cache key when something has to be
 * rebuilt per document. Comparing `viewer.document` identity is not enough on
 * its own, because the reopen produces a genuinely different document that
 * shows the same file.
 */
export function useDocumentGeneration(): number {
  const store = usePdfrxStore();
  const getSnapshot = useCallback(() => store.documentGeneration, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * A counter that increments whenever pages are added, removed, rotated or
 * reordered within the current document.
 *
 * `PdfDocument.setPages`/`setPage` renumber pages without producing a new
 * document, so {@link useDocumentGeneration} does not move. Anything keyed by
 * page number — a thumbnail strip, an outline's destinations, a page counter —
 * has to be rebuilt on this instead.
 */
export function usePdfPagesRevision(): number {
  const store = usePdfrxStore();
  const getSnapshot = useCallback(() => store.pagesRevision, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Receives exact page-arrangement events without deriving mutations from React renders. */
export type PdfPageChangeListener = (event: PdfDocumentEventMap['pagesRearranged']) => void;

/**
 * Subscribes to page-arrangement mutations on the current document.
 *
 * Remote adapters should ignore events whose `origin` is `remote`, `restore`,
 * `history`, or `materialize` to avoid echoing applied or internal changes.
 */
export function usePdfPageChanges(listener: PdfPageChangeListener): void {
  const viewer = usePdfrxViewer();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const document = viewer?.document;
    if (!document) return;
    return document.addEventListener('pagesRearranged', (event) => listenerRef.current(event));
  }, [viewer, viewer?.document]);
}
