import { useCallback, useEffect, useState } from 'react';
import { usePdfrxViewer } from './use-pdfrx-viewer.js';

/** Shared annotation/page-edit Undo/Redo state. */
export interface PdfEditHistory {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  /** Drops every Undo/Redo entry without changing the current document. */
  clearHistory: () => void;
}

/**
 * Accesses the viewer's single chronological annotation/page-edit history.
 * Call the returned `clearHistory` before intentionally materializing the live
 * page arrangement with `PdfDocument.assemblePages()` or `encodePdf()`.
 */
export function useEditHistory(): PdfEditHistory {
  const viewer = usePdfrxViewer();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    const sync = (): void => {
      setCanUndo(viewer?.canUndo() ?? false);
      setCanRedo(viewer?.canRedo() ?? false);
    };
    sync();
    return viewer?.addHistoryChangeListener(sync);
  }, [viewer]);

  const undo = useCallback(async (): Promise<void> => {
    await viewer?.undo();
  }, [viewer]);
  const redo = useCallback(async (): Promise<void> => {
    await viewer?.redo();
  }, [viewer]);
  const clearHistory = useCallback((): void => viewer?.clearHistory(), [viewer]);

  return { undo, redo, canUndo, canRedo, clearHistory };
}
