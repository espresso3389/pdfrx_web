import type { PdfDocument, PdfPage } from '@pdfrx/engine';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PdfrxProvider, usePdfrxStore, type PdfrxProviderProps } from '../context.js';
import { isImageFile, openFileAsDocument } from '../file-open.js';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { useEditHistory } from '../hooks/use-edit-history.js';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStrings } from '../strings.js';
import { PdfViewerSurface } from '../surface.js';
import { useImageAnnotationDrop } from '../use-image-annotation-drop.js';
import { PdfAnnotationToolbar } from './annotation-toolbar.js';
import { PdfPageActions, type PdfPageRotationDelta } from './page-actions.js';
import { IconAnnotate, IconClose, IconOpenFile, IconRedo, IconSave, IconUndo } from './icons.js';
import { PdfSidebar, type PdfSidebarProps } from './sidebar.js';
import { PdfToolbar, type PdfToolbarProps } from './toolbar.js';

/** Props for {@link PdfrxViewerApp}. */
export interface PdfrxViewerAppProps extends PdfrxProviderProps {
  className?: string;
  style?: CSSProperties;
  /** Show the toolbar. Defaults to `true`. */
  toolbar?: boolean;
  /** Extra props for the toolbar, e.g. to hide the print button. Pass extra controls as `children` instead. */
  toolbarProps?: Omit<
    PdfToolbarProps,
    'showSidebarToggle' | 'onToggleSidebar' | 'sidebarTogglePosition' | 'afterZoom' | 'children'
  >;
  /** Show the thumbnails/outline sidebar. Defaults to `true`. */
  sidebar?: boolean;
  /** Extra props for the sidebar, e.g. `defaultTab`. */
  sidebarProps?: Omit<PdfSidebarProps, 'onNavigate' | 'renderPageActions' | 'onInsertFiles' | 'onMovePage'>;
  /** Sidebar width in CSS pixels. Defaults to `190`. */
  sidebarWidth?: number;
  /**
   * Which side the sidebar sits on. Defaults to `'left'`. On a narrow screen
   * the drawer slides in from this side too.
   */
  sidebarSide?: 'left' | 'right';
  /**
   * Add an "open file" button. PDFs open directly; images (PNG, JPEG, GIF,
   * WebP, …) are converted to a one-page PDF and shown. Defaults to `false`.
   */
  enableFileOpen?: boolean;
  /**
   * Add per-page rotate/delete controls to the sidebar, a download button that
   * serializes the edited document, drop-to-insert on the thumbnail strip (drop
   * a PDF or image between two pages to insert its pages there), and
   * drag-to-reorder of thumbnails. Defaults to `false`.
   */
  enablePageEditing?: boolean;
  /** Show the toolbar's "open file" button. Defaults to {@link enableFileOpen}. */
  showOpenButton?: boolean;
  /**
   * Show the toolbar's download button. Works with or without
   * {@link enablePageEditing} (it serializes whatever the document currently
   * is). Defaults to {@link enablePageEditing}.
   */
  showDownloadButton?: boolean;
  /**
   * Show the toolbar's *Annotate* button (right of search), which reveals the
   * annotation toolbar and enters annotation-object mode; closing it returns
   * to viewing/text-selection mode. Alt/Option temporarily inverts the mode.
   * toolbar can add an image stamp at the center of the current page, while
   * images dropped onto a page are centered at the drop point. Both paths use
   * the same bounded size and fit oversized images within the page. Requires the viewer's
   * `interactiveAnnotations` (on by default). Defaults to `true`.
   */
  enableAnnotations?: boolean;
  /** Extra toolbar controls, placed after the built-in ones. */
  children?: ReactNode;
  /**
   * Renders a controller inside the app's viewer provider. Call
   * `context.renderChrome()` with only the editing operations and slots the
   * host needs to replace; omitted behavior keeps the standard implementation.
   */
  renderContent?: (context: PdfrxViewerAppRenderContext) => ReactNode;
}

/**
 * Host overrides for the standard {@link PdfrxViewerApp} chrome.
 *
 * Hosts can replace selected editing operations while retaining the built-in
 * responsive layout and controls.
 */
export interface PdfrxViewerAppOverrides {
  /**
   * Handles a file selected through the standard Open button. Omit this to
   * replace the current document locally through the built-in store.
   *
   * @example Equivalent to the default behavior
   * ```tsx
   * const { open } = usePdfDocument();
   * return renderChrome({ openFile: (file) => open(file) });
   * ```
   */
  readonly openFile?: (file: File) => void | Promise<void>;
  /**
   * Handles files dropped into a thumbnail insertion slot. `index` is the
   * zero-based slot before which new pages should be inserted, from `0`
   * through the current page count. Omit this for local page import.
   *
   * @example Equivalent to the default behavior
   * ```tsx
   * const viewer = usePdfrxViewer();
   * const store = usePdfrxStore();
   *
   * const insertFiles = async (files: File[], index: number) => {
   *   const document = viewer?.document;
   *   const engine = viewer?.engine;
   *   if (!document || !engine) return;
   *
   *   const inserted: PdfPage[] = [];
   *   for (const file of files) {
   *     try {
   *       const source = await openFileAsDocument(engine, file, {
   *         passwordProvider: store.passwordProvider,
   *         imageDecoder: store.imageDecoder,
   *       });
   *       inserted.push(...source.pages);
   *     } catch (error) {
   *       store.reportImportError(error, file.name);
   *     }
   *   }
   *
   *   const at = Math.max(0, Math.min(index, document.pages.length));
   *   if (inserted.length > 0) {
   *     viewer.setPages([
   *       ...document.pages.slice(0, at),
   *       ...inserted,
   *       ...document.pages.slice(at),
   *     ]);
   *   }
   * };
   *
   * return renderChrome({ insertFiles });
   * ```
   */
  readonly insertFiles?: (files: File[], index: number) => void | Promise<void>;
  /**
   * Handles thumbnail reordering. `fromPageNumber` is one-based and `toIndex`
   * is the zero-based insertion slot in the pre-move page list. Omit this to
   * reorder the local document directly.
   *
   * @example Equivalent to the default behavior
   * ```tsx
   * const viewer = usePdfrxViewer();
   * const movePage = (fromPageNumber: number, toIndex: number) => {
   *   const pages = viewer?.document?.pages.slice();
   *   if (!pages) return;
   *   const from = fromPageNumber - 1;
   *   if (toIndex === from || toIndex === from + 1) return;
   *   const [moved] = pages.splice(from, 1);
   *   if (!moved) return;
   *   pages.splice(toIndex > from ? toIndex - 1 : toIndex, 0, moved);
   *   viewer.setPages(pages);
   * };
   * return renderChrome({ movePage });
   * ```
   */
  readonly movePage?: (fromPageNumber: number, toIndex: number) => void;
  /**
   * Handles a sidebar rotation action for a one-based page number. Omit this
   * to replace the page with the locally rotated page.
   *
   * @example Equivalent to the default behavior
   * ```tsx
   * const viewer = usePdfrxViewer();
   * const rotatePage = (pageNumber: number, delta: PdfPageRotationDelta) => {
   *   const page = viewer?.document?.pages[pageNumber - 1];
   *   if (page) viewer.setPage(pageNumber, page.rotatedBy(delta));
   * };
   * return renderChrome({ rotatePage });
   * ```
   */
  readonly rotatePage?: (pageNumber: number, delta: PdfPageRotationDelta) => void;
  /**
   * Handles a sidebar deletion action for a one-based page number. Omit this
   * to remove the page from the local document.
   *
   * @example Equivalent to the default behavior
   * ```tsx
   * const viewer = usePdfrxViewer();
   * const deletePage = (pageNumber: number) => {
   *   const pages = viewer?.document?.pages;
   *   if (!pages || pages.length <= 1) return;
   *   viewer.setPages(pages.filter((page) => page.pageNumber !== pageNumber));
   * };
   * return renderChrome({ deletePage });
   * ```
   */
  readonly deletePage?: (pageNumber: number) => void;
  /**
   * Produces the PDF bytes downloaded by the standard Download button. The app
   * flushes active annotation text editing before calling this function and
   * still owns blob creation and browser download. Omit it to use
   * `document.encodePdf({ mode: 'copy' })`.
   *
   * @example Equivalent to the default behavior
   * ```tsx
   * return renderChrome({
   *   encode: (document) => document.encodePdf({ mode: 'copy' }),
   * });
   * ```
   */
  readonly encode?: (document: PdfDocument) => Promise<Uint8Array>;
  /** Receives an error thrown while preparing or starting a PDF download. */
  readonly onSaveError?: (error: unknown) => void;
  /**
   * Compact host UI rendered below the standard toolbar, annotation toolbar,
   * and built-in error banner, but above the sidebar/surface row.
   */
  readonly beforeBody?: ReactNode;
  /**
   * Disables host-sensitive editing entry points without hiding the document.
   * This covers open, page actions and drops, history buttons, download,
   * annotation entry, and image drops.
   */
  readonly editingDisabled?: boolean;
}

/** Render API passed to {@link PdfrxViewerAppProps.renderContent}. */
export interface PdfrxViewerAppRenderContext {
  /**
   * Renders the complete standard viewer chrome with optional behavior
   * overrides. Call this exactly once from the controller's rendered output.
   */
  readonly renderChrome: (overrides?: PdfrxViewerAppOverrides) => ReactNode;
}

/** Below this width the sidebar becomes an overlay drawer. */
const NARROW_BREAKPOINT = 780;

/**
 * The whole viewer in one component: toolbar, thumbnails/outline sidebar,
 * search, print, and the page surface — the equivalent of the standalone demo.
 *
 * Reach for this when you want a PDF viewer rather than a PDF viewer toolkit.
 * When the layout has to be yours, drop down to {@link PdfrxProvider} and
 * arrange {@link PdfToolbar}, {@link PdfSidebar} and {@link PdfViewerSurface}
 * (and the hooks) as you like — this component is a thin composition of exactly
 * those pieces.
 *
 * Needs `@pdfrx/react/styles.css` imported, and a size: it fills its box.
 *
 * @example
 * ```tsx
 * import { PdfrxViewerApp } from '@pdfrx/react';
 * import '@pdfrx/react/styles.css';
 *
 * <PdfrxViewerApp src="/manual.pdf" wasmModulesUrl="/pdfium/" style={{ height: '100vh' }} enableFileOpen />
 * ```
 */
export function PdfrxViewerApp({
  className,
  style,
  toolbar = true,
  toolbarProps,
  sidebar = true,
  sidebarProps,
  sidebarWidth = 190,
  sidebarSide = 'left',
  enableFileOpen = false,
  enablePageEditing = false,
  showOpenButton,
  showDownloadButton,
  enableAnnotations = true,
  children,
  renderContent,
  ...providerProps
}: PdfrxViewerAppProps): ReactNode {
  const pageEditingEnabled = enablePageEditing && providerProps.editing?.pages !== false;
  const annotationEditingEnabled = enableAnnotations && providerProps.editing?.annotations !== false;
  const historyEnabled = providerProps.editing?.history !== false;
  return (
    <PdfrxProvider {...providerProps}>
      <PdfrxViewerAppHost
        chromeProps={{
          className, style, toolbar, toolbarProps, sidebar, sidebarProps, sidebarWidth, sidebarSide,
          enablePageEditing: pageEditingEnabled,
          showOpenButton: showOpenButton ?? enableFileOpen,
          showDownloadButton: showDownloadButton ?? pageEditingEnabled,
          enableAnnotations: annotationEditingEnabled,
          historyEnabled,
          children,
        }}
        renderContent={renderContent}
      />
    </PdfrxProvider>
  );
}

type ChromeProps = Pick<
  PdfrxViewerAppProps,
  | 'className'
  | 'style'
  | 'toolbar'
  | 'toolbarProps'
  | 'sidebar'
  | 'sidebarProps'
  | 'sidebarWidth'
  | 'sidebarSide'
  | 'enablePageEditing'
  | 'showOpenButton'
  | 'showDownloadButton'
  | 'enableAnnotations'
  | 'children'
> & { historyEnabled: boolean };

function PdfrxViewerAppHost({
  chromeProps,
  renderContent,
}: {
  chromeProps: ChromeProps;
  renderContent?: PdfrxViewerAppProps['renderContent'];
}): ReactNode {
  const renderChrome = (overrides?: PdfrxViewerAppOverrides): ReactNode => (
    <PdfrxViewerAppChrome {...chromeProps} overrides={overrides} />
  );
  return renderContent ? renderContent({ renderChrome }) : renderChrome();
}

/**
 * The chrome, rendered inside the provider so it can use the hooks. Split out
 * only because a component cannot consume a context it renders itself.
 */
function PdfrxViewerAppChrome({
  className,
  style,
  toolbar,
  toolbarProps,
  sidebar,
  sidebarProps,
  sidebarWidth,
  sidebarSide = 'left',
  enablePageEditing,
  showOpenButton,
  showDownloadButton,
  enableAnnotations,
  historyEnabled,
  children,
  overrides,
}: ChromeProps & { overrides?: PdfrxViewerAppOverrides }): ReactNode {
  const { open, error, clearError } = usePdfDocument();
  const store = usePdfrxStore();
  const viewer = usePdfrxViewer();
  const strings = usePdfrxStrings();
  const { undo, redo, canUndo, canRedo } = useEditHistory();
  const isNarrow = useIsNarrow();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [annotating, setAnnotating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorMessageRef = useRef('');
  if (error !== null) {
    errorMessageRef.current =
      store.errorKind === 'import'
        ? strings.failedToImport(store.errorFileName ?? '', describeError(error))
        : strings.failedToOpen(describeError(error));
  }

  // Batteries-included default: prompt for a password when a document is
  // encrypted. Only a fallback — an app-supplied `passwordProvider` prop wins
  // (see PdfrxViewerStore.passwordProvider). Re-registered on locale change so
  // the prompt follows the active strings.
  useEffect(() => {
    store.setFallbackPasswordProvider(() => window.prompt(strings.enterPassword));
    return () => store.setFallbackPasswordProvider(undefined);
  }, [store, strings]);

  // On a phone the drawer would cover the document, so it starts closed there
  // and opens on a wide window. This also keeps a window that is resized across
  // the breakpoint from leaving the drawer stuck in the wrong state.
  useEffect(() => {
    setIsSidebarOpen(!isNarrow);
  }, [isNarrow]);

  const openFile = useCallback(
    (file: File) => {
      const result = overrides?.openFile ? overrides.openFile(file) : open(file);
      void Promise.resolve(result).catch((e: unknown) => console.error(`Failed to open ${file.name}:`, e));
    },
    [open, overrides],
  );

  // Insert dropped files as pages at `index`. Each file is opened in the
  // viewer's own engine (cross-document page import only works within one
  // engine); the source documents stay open because the arrangement borrows
  // their pages until the document is next replaced or serialized.
  const insertFiles = useCallback(
    async (files: File[], index: number): Promise<void> => {
      const document = viewer?.document;
      const engine = viewer?.engine;
      if (!document || !engine) return;
      const inserted: PdfPage[] = [];
      for (const file of files) {
        try {
          const doc = await openFileAsDocument(engine, file, {
            passwordProvider: store.passwordProvider,
            imageDecoder: store.imageDecoder,
          });
          inserted.push(...doc.pages);
        } catch (e) {
          console.error(`Failed to open ${file.name} for insertion:`, e);
          store.reportImportError(e, file.name);
        }
      }
      if (inserted.length === 0) return;
      const pages = document.pages;
      const at = Math.max(0, Math.min(index, pages.length));
      viewer.setPages([...pages.slice(0, at), ...inserted, ...pages.slice(at)]);
    },
    [viewer, store],
  );

  const imageAnnotationDrop = useImageAnnotationDrop({
    enabled: enableAnnotations && !overrides?.editingDisabled,
    onError: (error, file) => {
      console.error(`Failed to add image annotation from ${file.name}:`, error);
      store.reportImportError(error, file.name);
    },
  });

  useEffect(() => {
    if (overrides?.editingDisabled) setAnnotating(false);
  }, [overrides?.editingDisabled]);

  // Move a page (1-based) to the slot before `toIndex` (0-based). A synchronous
  // rearrangement — no worker round-trip until the document is serialized.
  const movePage = useCallback(
    (fromPageNumber: number, toIndex: number): void => {
      const document = viewer?.document;
      if (!document) return;
      const from = fromPageNumber - 1;
      // Dropping just before or after itself leaves the order unchanged.
      if (toIndex === from || toIndex === from + 1) return;
      const pages = document.pages.slice();
      const moved = pages[from];
      if (!moved) return;
      pages.splice(from, 1);
      pages.splice(toIndex > from ? toIndex - 1 : toIndex, 0, moved);
      viewer.setPages(pages);
    },
    [viewer],
  );

  const closeDrawerIfNarrow = useCallback(() => {
    if (isNarrow) setIsSidebarOpen(false);
  }, [isNarrow]);

  const renderPageActions = enablePageEditing
    ? (pageNumber: number): ReactNode => (
      <PdfPageActions
        pageNumber={pageNumber}
        onRotatePage={overrides?.rotatePage}
        onDeletePage={overrides?.deletePage}
        disabled={overrides?.editingDisabled}
      />
    )
    : undefined;

  // On a wide screen the slot animates its width between `sidebarWidth` and 0
  // to reveal/collapse the sidebar (whose own width stays fixed, so its content
  // never reflows mid-animation). On a narrow screen the slot takes no space and
  // the sidebar itself becomes the sliding drawer (see styles.css).
  const sidebarNode = sidebar ? (
    <div className="pdfrx-sidebar-slot" style={{ width: !isNarrow && isSidebarOpen ? sidebarWidth : 0 }}>
      <PdfSidebar
        {...sidebarProps}
        style={{ width: sidebarWidth, ...sidebarProps?.style }}
        onNavigate={closeDrawerIfNarrow}
        renderPageActions={renderPageActions}
        onInsertFiles={enablePageEditing && !overrides?.editingDisabled
          ? (files, index) => void (overrides?.insertFiles ?? insertFiles)(files, index)
          : undefined}
        onMovePage={enablePageEditing && !overrides?.editingDisabled ? (overrides?.movePage ?? movePage) : undefined}
      />
    </div>
  ) : null;

  return (
    <div
      className={
        isNarrow ? `pdfrx-app pdfrx-app-narrow ${className ?? ''}`.trim() : `pdfrx-app ${className ?? ''}`.trim()
      }
      style={style}
      data-sidebar-open={isSidebarOpen}
      data-sidebar-side={sidebarSide}
    >
      {toolbar && (
        <PdfToolbar
          {...toolbarProps}
          showSidebarToggle={sidebar}
          onToggleSidebar={() => setIsSidebarOpen((previous) => !previous)}
          // Put the hamburger next to the sidebar it controls.
          sidebarTogglePosition={sidebarSide === 'right' ? 'end' : 'start'}
          afterZoom={(enableAnnotations || enablePageEditing) ? (
            <>
              {historyEnabled ? <><button
                type="button"
                className="pdfrx-button"
                onClick={() => void undo()}
                disabled={overrides?.editingDisabled || !canUndo}
                title={`${strings.undo} (Ctrl+Z)`}
                aria-label={strings.undo}
              >
                <IconUndo />
              </button>
              <button
                type="button"
                className="pdfrx-button"
                onClick={() => void redo()}
                disabled={overrides?.editingDisabled || !canRedo}
                title={`${strings.redo} (Ctrl+Shift+Z)`}
                aria-label={strings.redo}
              >
                <IconRedo />
              </button></> : null}
              {enableAnnotations && (
                <button
                  className={`pdfrx-button${annotating ? ' pdfrx-button-active' : ''}`}
                  aria-pressed={annotating}
                  disabled={overrides?.editingDisabled}
                  onClick={() => setAnnotating((v) => !v)}
                  title={strings.annotate}
                  aria-label={strings.annotate}
                >
                  <IconAnnotate />
                </button>
              )}
            </>
          ) : undefined}
        >
          {showOpenButton && (
            <>
              <button
                className="pdfrx-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={overrides?.editingDisabled}
                title={strings.openFile}
                aria-label={strings.openFile}
              >
                <IconOpenFile />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf,image/*,.heic,.heif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // let the same file be picked twice
                  if (file) openFile(file);
                }}
              />
            </>
          )}
          {showDownloadButton && (
            <SaveButton
              encode={overrides?.encode}
              onError={overrides?.onSaveError}
              disabled={overrides?.editingDisabled}
            />
          )}
          {children}
        </PdfToolbar>
      )}
      {enableAnnotations && (
        <div
          className={`pdfrx-collapsible${annotating ? ' pdfrx-collapsible-open' : ''}`}
          aria-hidden={!annotating}
          inert={!annotating}
        >
          <div className="pdfrx-collapsible-content">
            <div className="pdfrx-toolbar pdfrx-toolbar-annot">
              <PdfAnnotationToolbar
                modeActive={annotating}
                onClose={() => setAnnotating(false)}
              />
            </div>
          </div>
        </div>
      )}
      <div
        className={`pdfrx-collapsible${error !== null ? ' pdfrx-collapsible-open' : ''}`}
        aria-hidden={error === null}
        inert={error === null}
      >
        <div className="pdfrx-collapsible-content">
          <div className="pdfrx-error" role={error !== null ? 'alert' : undefined}>
            <span className="pdfrx-error-message">{errorMessageRef.current}</span>
            <button
              className="pdfrx-button pdfrx-error-dismiss"
              onClick={clearError}
              title={strings.dismissError}
              aria-label={strings.dismissError}
            >
              <IconClose />
            </button>
          </div>
        </div>
      </div>
      {overrides?.beforeBody}
      <div className="pdfrx-app-body">
        {/* Kept mounted while closed: the drawer animates out on narrow screens,
            and a `display: none` sidebar stops its thumbnails from rendering
            anyway (a hidden element never intersects the viewport). The sidebar
            renders before or after the surface so it lands on the chosen side. */}
        {sidebar && sidebarSide === 'left' && sidebarNode}
        <PdfViewerSurface
          style={{ flex: 1 }}
          {...imageAnnotationDrop}
        />
        {sidebar && sidebarSide === 'right' && sidebarNode}
        {sidebar && isSidebarOpen && isNarrow && (
          <button className="pdfrx-scrim" aria-label={strings.closeSidebar} onClick={() => setIsSidebarOpen(false)} />
        )}
      </div>
    </div>
  );
}

/** Serializes the (possibly edited) document and downloads it. */
function SaveButton({
  encode,
  onError,
  disabled = false,
}: {
  encode?: (document: PdfDocument) => Promise<Uint8Array>;
  onError?: (error: unknown) => void;
  disabled?: boolean;
}): ReactNode {
  const viewer = usePdfrxViewer();
  const { pageCount, sourceName } = usePdfDocument();
  const strings = usePdfrxStrings();
  const [isSaving, setIsSaving] = useState(false);

  const save = async (): Promise<void> => {
    const document = viewer?.document;
    if (!document) return;
    setIsSaving(true);
    try {
      await viewer.flushAnnotationTextEdit();
      // Assemble a temporary copy so saving does not invalidate editing history.
      const data = encode ? await encode(document) : await document.encodePdf({ mode: 'copy' });
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName(sourceName);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to save the document:', e);
      onError?.(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <button
      className="pdfrx-button"
      onClick={() => void save()}
      disabled={disabled || isSaving || pageCount === 0}
      title={strings.download}
      aria-busy={isSaving}
    >
      {isSaving ? <span className="pdfrx-busy-indicator" aria-hidden="true" /> : <IconSave />}
    </button>
  );
}

/** `sourceName` may be a file name or a `uri%https://host/dir/file.pdf` form. */
function downloadName(sourceName: string | null): string {
  const base =
    (sourceName ?? '')
      .split(/[/\\]/)
      .pop()
      ?.split('?')[0]
      ?.replace(/\.pdf$/i, '') || 'document';
  return `${base}.pdf`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tracks whether the window is narrow enough to turn the sidebar into a drawer. */
function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);
    setIsNarrow(query.matches);
    const onChange = (e: MediaQueryListEvent): void => setIsNarrow(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return isNarrow;
}
