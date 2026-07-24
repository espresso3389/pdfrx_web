import type { PdfImageDecoder, PdfPasswordProvider } from '@pdfrx/engine';
import type { PdfrxViewerOptions } from '@pdfrx/viewer';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PdfSource } from './source.js';
import { PdfrxViewerStore } from './store.js';
import { PdfrxStringsContext, type PdfrxStrings } from './strings.js';
import { resolvePdfrxStrings } from './locales.js';
import type { PdfReactContextMenuBuilder } from './context-menu.js';

const StoreContext = createContext<PdfrxViewerStore | null>(null);

/** Props for {@link PdfrxProvider}. */
export interface PdfrxProviderProps extends Omit<PdfrxViewerOptions, 'contextMenuBuilder'> {
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
  /**
   * Supplies passwords for encrypted documents, applied to every built-in open
   * (the `src` prop, the file-open button, page insertion) whose
   * source does not carry its own. Called again on each wrong password until it
   * returns a correct one or `null` (which aborts). See {@link PdfPasswordProvider}.
   *
   * `PdfrxProvider` has no default — omit it and encrypted documents fail to
   * open. {@link PdfrxViewerApp} installs a localized `window.prompt` fallback
   * unless you pass one here.
   *
   * @example
   * ```tsx
   * <PdfrxProvider src="/secret.pdf" passwordProvider={() => prompt('Password:')} />
   * ```
   */
  passwordProvider?: PdfPasswordProvider;
  /**
   * Decodes image formats unsupported by the browser, for every built-in image
   * path: opening an image, inserting it as a page, and adding an image stamp.
   * Without this prop, encoded formats unsupported by the current browser
   * (such as HEIC in Chrome) cannot be imported as pages or annotations.
   * Applications can add support without changing pdfrx by converting them to
   * JPEG/PNG or decoded RGBA8888/BGRA8888 pixels here.
   * Return JPEG/PNG/etc. encoded data or decoded RGBA/BGRA pixels.
   * See {@link PdfImageDecoder} for a HEIC example.
   */
  imageDecoder?: PdfImageDecoder;
  /**
   * UI language for the built-in components. A BCP-47 tag (or a priority list),
   * matched against the built-in languages (English, Japanese, Simplified and
   * Traditional Chinese, French, German), with English as the fallback. Omit it
   * to auto-detect from the browser (`navigator.languages`). See
   * {@link resolvePdfrxStrings}.
   */
  locale?: string | readonly string[];
  /**
   * Per-string overrides applied on top of {@link locale} — for tweaking a few
   * labels, or supplying a language the package doesn't ship (set `locale` to it
   * and provide the strings here; anything omitted falls back to English). See
   * {@link PdfrxStrings}. Pass a stable (module-level or memoized) object.
   */
  strings?: Partial<PdfrxStrings>;
  /**
   * Replaces the right-click / long-press context menu. Receives the viewer and
   * active strings alongside the event context, so you can reuse
   * {@link buildDefaultContextMenu} and add your own items. Omit it for the
   * built-in localized Copy / Select All menu. See {@link PdfReactContextMenuBuilder}.
   */
  contextMenuBuilder?: PdfReactContextMenuBuilder;
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
export function PdfrxProvider({
  src,
  wasmModulesUrl,
  onError,
  locale,
  strings,
  contextMenuBuilder,
  passwordProvider,
  imageDecoder,
  children,
  ...options
}: PdfrxProviderProps): ReactNode {
  const [store] = useState(() => new PdfrxViewerStore());

  // Resolve the locale to a base set of strings, then apply per-string overrides
  // on top. Keyed on locale + the override object, so a module-level/memoized
  // `strings` prop keeps the context value stable.
  const mergedStrings = useMemo(() => {
    const base = resolvePdfrxStrings(locale);
    return strings ? { ...base, ...strings } : base;
  }, [locale, strings]);

  // Keep the store's copies current so the context menu localizes and picks up
  // the app's builder without a viewer rebuild.
  store.setStrings(mergedStrings);
  store.setContextMenuBuilder(contextMenuBuilder);
  store.setPasswordProvider(passwordProvider);
  store.setImageDecoder(imageDecoder);

  options.annotationEditorPlaceholders = {
    text: mergedStrings.annotationTextPlaceholder,
    note: mergedStrings.annotationNotePlaceholder,
    addText: mergedStrings.annotationAddText,
    ...options.annotationEditorPlaceholders,
  };
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
      if (store.error !== null && store.error !== lastError && store.errorKind === 'open') onError(store.error);
      lastError = store.error;
    });
  }, [store, onError]);

  return (
    <StoreContext.Provider value={store}>
      <PdfrxStringsContext.Provider value={mergedStrings}>{children}</PdfrxStringsContext.Provider>
    </StoreContext.Provider>
  );
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
