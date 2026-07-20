import type { PdfOutlineNode } from '@pdfrx/engine';
import { useEffect, useState } from 'react';
import { usePdfrxViewer } from './use-pdfrx-viewer.js';
import { useDocumentGeneration } from './use-document-generation.js';

/** Outline state returned by {@link usePdfOutline}. */
export interface PdfOutlineState {
  /** The bookmark tree, `[]` when the document has none, `null` before it loads. */
  outline: readonly PdfOutlineNode[] | null;
  /** Whether the outline is being fetched. */
  isLoading: boolean;
}

/**
 * The document's outline (bookmarks), reloaded whenever the document changes.
 *
 * `viewer.loadOutline()` round-trips to the worker on every call and caches
 * nothing, so this hook holds the result for you. Activate a node with
 * `usePdfNavigation().goToDest(node.dest)`.
 *
 * @example
 * ```tsx
 * const { outline, isLoading } = usePdfOutline();
 * const { goToDest } = usePdfNavigation();
 * if (isLoading) return <p>Loading…</p>;
 * return outline?.map((n) => <button key={n.title} onClick={() => goToDest(n.dest)}>{n.title}</button>);
 * ```
 */
export function usePdfOutline(): PdfOutlineState {
  const viewer = usePdfrxViewer();
  const generation = useDocumentGeneration();
  const [state, setState] = useState<PdfOutlineState>({ outline: null, isLoading: false });

  useEffect(() => {
    if (!viewer || !viewer.document) {
      setState({ outline: null, isLoading: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, isLoading: true }));
    void viewer
      .loadOutline()
      .then((outline) => {
        if (!cancelled) setState({ outline, isLoading: false });
      })
      .catch((e: unknown) => {
        console.error('Failed to load the PDF outline:', e);
        if (!cancelled) setState({ outline: [], isLoading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [viewer, generation]);

  return state;
}
