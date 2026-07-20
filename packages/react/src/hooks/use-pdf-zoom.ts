import type { Offset } from '@pdfrx/viewer';
import { useCallback, useMemo } from 'react';
import { usePdfrxStore } from '../context.js';
import { shallowEqual, useViewerSnapshot } from './use-viewer-snapshot.js';

/** Zoom state and actions returned by {@link usePdfZoom}. */
export interface PdfZoom {
  /** Current zoom, where `1` means one PDF point per CSS pixel. */
  zoom: number;
  /** Whether {@link zoomIn} would change anything (i.e. the max is not reached). */
  canZoomIn: boolean;
  /** Whether {@link zoomOut} would change anything. */
  canZoomOut: boolean;
  /** Steps to the next zoom stop (√2 apart by default). */
  zoomIn: (duration?: number) => void;
  /** Steps to the previous zoom stop. */
  zoomOut: (duration?: number) => void;
  /** Sets an absolute zoom, keeping `viewCenter` (default: the viewport center) fixed. */
  setZoom: (zoom: number, viewCenter?: Offset, duration?: number) => void;
  /** Fits a whole page in the viewport (default: the current page). */
  fitToPage: (pageNumber?: number, duration?: number) => void;
  /** Fits a page's width, aligned to its top. */
  fitToWidth: (pageNumber?: number, duration?: number) => void;
  /** Fits a page's height. */
  fitToHeight: (pageNumber?: number, duration?: number) => void;
}

/** How long zoom-button animations run, in ms. Matches what feels right for a click. */
const DEFAULT_ZOOM_DURATION = 200;

/**
 * Current zoom level and the controls for changing it.
 *
 * Re-renders on every pan and zoom, so keep it in a small component (a zoom
 * toolbar) rather than high in the tree.
 *
 * @example
 * ```tsx
 * const { zoom, zoomIn, zoomOut, canZoomIn, fitToWidth } = usePdfZoom();
 * return (
 *   <>
 *     <button onClick={() => zoomOut()}>−</button>
 *     <span>{Math.round(zoom * 100)}%</span>
 *     <button onClick={() => zoomIn()} disabled={!canZoomIn}>+</button>
 *     <button onClick={() => fitToWidth()}>Fit width</button>
 *   </>
 * );
 * ```
 */
export function usePdfZoom(): PdfZoom {
  const store = usePdfrxStore();

  const state = useViewerSnapshot(
    (viewer, onChange) => {
      const offTransform = viewer.addTransformChangeListener(onChange);
      const offDocument = viewer.addDocumentChangeListener(onChange);
      return () => {
        offTransform();
        offDocument();
      };
    },
    (viewer) => {
      const zoom = viewer?.zoom ?? 1;
      return {
        zoom,
        // getNextZoom/getPreviousZoom clamp to the viewer's own min/max (which
        // are not otherwise readable), so comparing against the current zoom is
        // how we learn whether a limit has been reached.
        canZoomIn: viewer ? viewer.getNextZoom() > zoom : false,
        canZoomOut: viewer ? viewer.getPreviousZoom() < zoom : false,
      };
    },
    shallowEqual,
  );

  const zoomIn = useCallback(
    (duration = DEFAULT_ZOOM_DURATION) => store.viewer?.zoomUp(undefined, duration),
    [store],
  );
  const zoomOut = useCallback(
    (duration = DEFAULT_ZOOM_DURATION) => store.viewer?.zoomDown(undefined, duration),
    [store],
  );
  const setZoom = useCallback(
    (zoom: number, viewCenter?: Offset, duration?: number) => store.viewer?.setZoom(zoom, viewCenter, duration),
    [store],
  );
  const fitToPage = useCallback(
    (pageNumber?: number, duration?: number) => store.viewer?.fitToPage(pageNumber, duration),
    [store],
  );
  const fitToWidth = useCallback(
    (pageNumber?: number, duration?: number) => store.viewer?.fitToWidth(pageNumber, duration),
    [store],
  );
  const fitToHeight = useCallback(
    (pageNumber?: number, duration?: number) => store.viewer?.fitToHeight(pageNumber, duration),
    [store],
  );

  return useMemo(
    () => ({ ...state, zoomIn, zoomOut, setZoom, fitToPage, fitToWidth, fitToHeight }),
    [state, zoomIn, zoomOut, setZoom, fitToPage, fitToWidth, fitToHeight],
  );
}
