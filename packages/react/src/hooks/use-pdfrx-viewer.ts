import type { PdfrxViewer } from '@pdfrx/viewer';
import { useSyncExternalStore } from 'react';
import { usePdfrxStore } from '../context.js';

/**
 * The underlying {@link PdfrxViewer}, or `null` until {@link PdfViewerSurface}
 * has mounted (and again after it unmounts).
 *
 * This is the escape hatch: anything the typed hooks do not cover — custom
 * layouts, page overlays, coordinate conversion, direct `@pdfrx/engine` access
 * through `viewer.document` — is reachable from here.
 *
 * Remember that the viewer owns its document: any `PdfDocument`/`PdfPage` you
 * hold becomes invalid as soon as another document is opened, so re-read them
 * rather than caching across loads.
 *
 * @example
 * ```tsx
 * const viewer = usePdfrxViewer();
 * const onClick = () => viewer?.selectAll();
 * ```
 */
export function usePdfrxViewer(): PdfrxViewer | null {
  const store = usePdfrxStore();
  return useSyncExternalStore(store.subscribe, store.getViewer, store.getViewer);
}
