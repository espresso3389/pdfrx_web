import type { ViewerSpreadMode } from '@pdfrx/viewer';
import { useCallback, type ReactNode } from 'react';
import { usePdfrxStore } from '../context.js';
import { usePdfrxStrings } from '../strings.js';
import { shallowEqual, useViewerSnapshot } from '../hooks/use-viewer-snapshot.js';
import { IconSpread } from './icons.js';

/** Cycles single-page, paired, and cover-first book layouts. */
export function PdfSpreadButton(): ReactNode {
  const store = usePdfrxStore();
  const strings = usePdfrxStrings();
  const { mode, hasDocument } = useViewerSnapshot(
    (viewer, onChange) => {
      const offTransform = viewer.addTransformChangeListener(onChange);
      const offDocument = viewer.addDocumentChangeListener(onChange);
      return () => { offTransform(); offDocument(); };
    },
    (viewer) => ({ mode: viewer?.spreadMode ?? 'none', hasDocument: (viewer?.pageCount ?? 0) > 0 }),
    shallowEqual,
  );
  const setMode = useCallback((next: ViewerSpreadMode) => store.viewer?.setSpreadMode(next), [store]);
  const next: ViewerSpreadMode = mode === 'none' ? 'odd' : mode === 'odd' ? 'even' : 'none';
  const label = next === 'none' ? strings.spreadNone : next === 'odd' ? strings.spreadOdd : strings.spreadEven;
  return (
    <button
      type="button"
      className={`pdfrx-button${mode !== 'none' ? ' pdfrx-button-active' : ''}`}
      onClick={() => setMode(next)}
      disabled={!hasDocument}
      title={label}
      aria-label={label}
      aria-pressed={mode !== 'none'}
    >
      <IconSpread />
    </button>
  );
}
