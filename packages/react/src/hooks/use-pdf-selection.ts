import type { PdfSelectedTextRange, PdfTextSelectionRange } from '@pdfrx/viewer';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePdfrxStore } from '../context.js';
import { useViewerSnapshot } from './use-viewer-snapshot.js';

/** Selection state and actions returned by {@link usePdfSelection}. */
export interface PdfSelection {
  /** The selected span as page/character endpoints, or `null` when nothing is selected. */
  range: PdfTextSelectionRange | null;
  /** Whether the selection is empty. */
  isEmpty: boolean;
  /** The selected text, or `''`. Resolved asynchronously — see the note below. */
  text: string;
  /** Per-page pieces of the selection, with bounds and character rects for drawing your own UI. */
  ranges: readonly PdfSelectedTextRange[];
  /** Whether {@link text}/{@link ranges} are still being resolved for the current {@link range}. */
  isResolving: boolean;
  /** Copies the selection to the clipboard. Resolves `false` if empty or copying is not permitted. */
  copy: () => Promise<boolean>;
  /** Selects the whole document (loads every page's text). */
  selectAll: () => Promise<void>;
  /** Clears the selection. */
  clear: () => void;
}

/**
 * The current text selection.
 *
 * `range` updates synchronously as the user drags, but the *text* behind it does
 * not exist until the pages it spans have loaded their text. This hook resolves
 * it in the background and reports `isResolving` meanwhile, so a status bar can
 * show the page range immediately and fill in the text when it arrives.
 *
 * @example
 * ```tsx
 * const { text, isEmpty, copy } = usePdfSelection();
 * if (isEmpty) return null;
 * return <button onClick={() => void copy()}>Copy “{text.slice(0, 20)}…”</button>;
 * ```
 */
export function usePdfSelection(): PdfSelection {
  const store = usePdfrxStore();

  const range = useViewerSnapshot(
    (viewer, onChange) => viewer.addSelectionChangeListener(onChange),
    (viewer) => viewer?.selection.range ?? null,
    // The viewer already deduplicates by endpoints, so the object identity from
    // one notification to the next is a faithful "did the selection change".
  );

  const [resolved, setResolved] = useState<{
    range: PdfTextSelectionRange | null;
    ranges: readonly PdfSelectedTextRange[];
  }>({ range: null, ranges: EMPTY_RANGES });

  useEffect(() => {
    if (!range) {
      setResolved({ range: null, ranges: EMPTY_RANGES });
      return;
    }
    let cancelled = false;
    void store.viewer?.selection
      .getSelectedTextRanges()
      .then((ranges) => {
        if (!cancelled) setResolved({ range, ranges });
      })
      .catch((e: unknown) => {
        console.error('Failed to resolve the PDF selection:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [store, range]);

  const copy = useCallback(async () => (await store.viewer?.copySelection()) ?? false, [store]);
  const selectAll = useCallback(async () => {
    await store.viewer?.selectAll();
  }, [store]);
  const clear = useCallback(() => store.viewer?.clearSelection(), [store]);

  return useMemo(() => {
    const isCurrent = resolved.range === range;
    const ranges = isCurrent ? resolved.ranges : EMPTY_RANGES;
    return {
      range,
      isEmpty: range === null,
      text: ranges.map((r) => r.text).join('\n'),
      ranges,
      isResolving: range !== null && !isCurrent,
      copy,
      selectAll,
      clear,
    };
  }, [range, resolved, copy, selectAll, clear]);
}

const EMPTY_RANGES: readonly PdfSelectedTextRange[] = [];
