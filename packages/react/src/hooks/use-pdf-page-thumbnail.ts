import { useEffect, useState } from 'react';
import { usePdfrxStore } from '../context.js';
import { useDocumentGeneration, usePdfPagesRevision } from './use-document-generation.js';
import { usePdfrxViewer } from './use-pdfrx-viewer.js';

/** Thumbnail state returned by {@link usePdfPageThumbnail}. */
export interface PdfPageThumbnail {
  /**
   * A canvas holding the rendered page, or `null` while it renders.
   *
   * It is owned by the provider's shared cache and may be shown in several
   * places at once, so **do not mutate or reparent it** — draw it into your own
   * canvas (see {@link PdfThumbnailList} for the pattern).
   */
  canvas: HTMLCanvasElement | null;
  isLoading: boolean;
}

/**
 * Renders one page as a thumbnail, through a cache shared by the whole provider.
 *
 * `viewer.renderPageThumbnail()` goes to the worker every time and caches
 * nothing, which a scrolling sidebar cannot afford. The cache here is keyed by
 * the page's *render key* (source page + rotation) rather than its number, so
 * reordering pages costs nothing and only a rotated page is re-rendered.
 *
 * @param pageNumber - 1-based page number, or `null` to render nothing.
 * @param width - Thumbnail width in CSS pixels. Rendered at device pixel ratio.
 */
export function usePdfPageThumbnail(pageNumber: number | null, width = 120): PdfPageThumbnail {
  const store = usePdfrxStore();
  const viewer = usePdfrxViewer();
  const generation = useDocumentGeneration();
  // A rotation or reorder changes what this page number renders as.
  const pagesRevision = usePdfPagesRevision();
  const [state, setState] = useState<PdfPageThumbnail>({ canvas: null, isLoading: false });

  useEffect(() => {
    if (!viewer || pageNumber === null || !viewer.document) {
      setState({ canvas: null, isLoading: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ canvas: previous.canvas, isLoading: true }));
    void store.thumbnails
      .get(viewer, pageNumber, width)
      .then((canvas) => {
        if (!cancelled) setState({ canvas, isLoading: false });
      })
      .catch((e: unknown) => {
        console.error(`Failed to render the thumbnail for page ${pageNumber}:`, e);
        if (!cancelled) setState({ canvas: null, isLoading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [store, viewer, pageNumber, width, generation, pagesRevision]);

  return state;
}
