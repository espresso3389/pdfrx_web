import type { PdfrxViewerOptions } from '@pdfrx/viewer';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PdfSource } from './source.js';
import { PdfrxViewerStore } from './store.js';

const StoreContext = createContext<PdfrxViewerStore | null>(null);

/** Props for {@link PdfrxProvider}. */
export interface PdfrxProviderProps extends PdfrxViewerOptions {
  /**
   * The document to show. A URL string is the common case; see
   * {@link PdfSource} for the byte-array, `File` and options-carrying forms.
   * Changing it opens the new document; an equivalent value is ignored, so an
   * inline literal is safe.
   */
  src?: PdfSource;
  /**
   * Shorthand for `engineOptions.wasmModulesUrl` — the directory holding
   * `pdfium_worker.js` and `pdfium.wasm`. Defaults to `'pdfium/'`.
   */
  wasmModulesUrl?: string;
  /** Called when opening `src` fails. The error is also available from `usePdfDocument()`. */
  onError?: (error: unknown) => void;
  children?: ReactNode;
}

/**
 * Root of every pdfrx React tree: owns the viewer and makes it reachable from
 * the hooks and components below it.
 *
 * The viewer itself is not created until a {@link PdfViewerSurface} mounts
 * somewhere inside, because the viewer needs a DOM node to paint into. Put
 * exactly one surface in the tree; everything else (toolbar, sidebar, search
 * box) can live wherever the layout calls for.
 *
 * Every {@link PdfrxViewerOptions} field is accepted as a prop and, except for
 * `engine`/`engineOptions`/`initialFit` (read once at construction), takes
 * effect when it changes.
 *
 * @example
 * ```tsx
 * <PdfrxProvider src="/manual.pdf" wasmModulesUrl="/pdfium/">
 *   <PdfToolbar />
 *   <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
 *     <PdfSidebar />
 *     <PdfViewerSurface style={{ flex: 1 }} />
 *   </div>
 * </PdfrxProvider>
 * ```
 */
export function PdfrxProvider({ src, wasmModulesUrl, onError, children, ...options }: PdfrxProviderProps): ReactNode {
  const [store] = useState(() => new PdfrxViewerStore());

  if (wasmModulesUrl !== undefined && options.engineOptions === undefined) {
    options.engineOptions = { wasmModulesUrl };
  }
  // Before the viewer exists, seeding during render is safe (nothing observes
  // the options yet) and necessary: the surface's mount effect runs after this
  // render and must construct the viewer with the right options.
  if (!store.viewer) store.updateOptions(options);
  // Afterwards, apply prop changes from an effect so render stays side-effect
  // free. No dependency array: `options` is a fresh object every render and
  // `updateOptions` is a cheap merge.
  useEffect(() => {
    if (store.viewer) store.updateOptions(options);
  });

  useEffect(() => {
    store.setSource(src);
  }, [store, src]);

  useEffect(() => {
    if (!onError) return;
    let lastError = store.error;
    return store.subscribe(() => {
      if (store.error !== null && store.error !== lastError) onError(store.error);
      lastError = store.error;
    });
  }, [store, onError]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/**
 * The {@link PdfrxViewerStore} for the nearest {@link PdfrxProvider}.
 *
 * @throws If called outside a `PdfrxProvider`.
 */
export function usePdfrxStore(): PdfrxViewerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('pdfrx hooks and components must be rendered inside a <PdfrxProvider>');
  return store;
}

/** Like {@link usePdfrxStore}, but returns `null` outside a provider instead of throwing. */
export function useOptionalPdfrxStore(): PdfrxViewerStore | null {
  return useContext(StoreContext);
}
