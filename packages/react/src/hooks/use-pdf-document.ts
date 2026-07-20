import type { PdfDocument } from '@pdfrx/engine';
import type { PdfLoadingProgress } from '@pdfrx/viewer';
import { useCallback, useMemo } from 'react';
import { usePdfrxStore } from '../context.js';
import type { PdfSource } from '../source.js';
import { shallowEqual, useViewerSnapshot } from './use-viewer-snapshot.js';

/** The document state returned by {@link usePdfDocument}. */
export interface PdfDocumentState {
  /** The open document, or `null` before the first successful load. */
  document: PdfDocument | null;
  /** The document's source name (file name or `uri%…`), or `null`. */
  sourceName: string | null;
  /** Number of pages, or `0` when nothing is open. */
  pageCount: number;
  /** A document is opening. The viewer paints a spinner instead of the old one. */
  isLoading: boolean;
  /** Download progress while opening a URL, or `null` when unknown/idle. */
  progress: PdfLoadingProgress | null;
  /** The error from the most recent open attempt, or `null`. */
  error: unknown;
  /** Whether the document's permissions allow copying text. */
  isCopyAllowed: boolean;
  /** Opens a different document imperatively (file picker, drag & drop, …). */
  open: (src: PdfSource) => Promise<void>;
}

/**
 * Load state and identity of the current document.
 *
 * Re-renders when the document changes and while it is downloading, so this is
 * what a progress bar, a page count, or an error banner should read from.
 *
 * @example
 * ```tsx
 * const { isLoading, progress, pageCount, error } = usePdfDocument();
 * if (error) return <p>Failed to open: {String(error)}</p>;
 * if (isLoading) return <progress value={progress?.bytesReceived} max={progress?.bytesTotal ?? undefined} />;
 * return <p>{pageCount} pages</p>;
 * ```
 */
export function usePdfDocument(): PdfDocumentState {
  const store = usePdfrxStore();

  const open = useCallback((src: PdfSource) => store.open(src), [store]);

  const state = useViewerSnapshot(
    (viewer, onChange) => {
      const offDocument = viewer.addDocumentChangeListener(onChange);
      const offLoading = viewer.addLoadingChangeListener(onChange);
      return () => {
        offDocument();
        offLoading();
      };
    },
    (viewer) => ({
      document: viewer?.document ?? null,
      sourceName: viewer?.document?.sourceName ?? null,
      pageCount: viewer?.pageCount ?? 0,
      isLoading: viewer?.isLoading ?? false,
      progress: viewer?.loadingProgress ?? null,
      error: store.error,
      isCopyAllowed: viewer?.isCopyAllowed ?? false,
    }),
    shallowEqual,
  );

  return useMemo(() => ({ ...state, open }), [state, open]);
}
