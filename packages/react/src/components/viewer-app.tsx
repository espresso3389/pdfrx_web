import type { PdfPage } from '@pdfrx/engine';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { PdfrxProvider, usePdfrxStore, type PdfrxProviderProps } from '../context.js';
import { isImageFile, isPdfFile, openFileAsDocument } from '../file-open.js';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { useEditHistory } from '../hooks/use-edit-history.js';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStrings } from '../strings.js';
import { PdfViewerSurface } from '../surface.js';
import { PdfAnnotationToolbar } from './annotation-toolbar.js';
import { IconAnnotate, IconClose, IconOpenFile, IconRedo, IconRotate, IconSave, IconTrash, IconUndo } from './icons.js';
import { PdfSidebar, type PdfSidebarProps } from './sidebar.js';
import { PdfToolbar, type PdfToolbarProps } from './toolbar.js';

/** Props for {@link PdfrxViewerApp}. */
export interface PdfrxViewerAppProps extends PdfrxProviderProps {
  className?: string;
  style?: CSSProperties;
  /** Show the toolbar. Defaults to `true`. */
  toolbar?: boolean;
  /** Extra props for the toolbar, e.g. to hide the print button. Pass extra controls as `children` instead. */
  toolbarProps?: Omit<PdfToolbarProps, 'showSidebarToggle' | 'onToggleSidebar' | 'sidebarTogglePosition' | 'children'>;
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
   * Add an "open file" button and accept dropped files. PDFs open directly;
   * images (PNG, JPEG, GIF, WebP, …) are converted to a one-page PDF and shown.
   * Defaults to `false`.
   */
  enableFileOpen?: boolean;
  /**
   * Add per-page rotate/delete controls to the sidebar, a download button that
   * serializes the edited document, drop-to-insert on the thumbnail strip (drop
   * a PDF or image between two pages to insert its pages there), and
   * drag-to-reorder of thumbnails. Defaults to `false`.
   */
  enablePageEditing?: boolean;
  /**
   * Show the toolbar's "open file" button. Independent of drag & drop, which
   * {@link enableFileOpen} controls. Defaults to {@link enableFileOpen}, so
   * set it to override just the button (e.g. `false` for drop-only, or `true`
   * without `enableFileOpen` for a picker with no drag & drop).
   */
  showOpenButton?: boolean;
  /**
   * Show the toolbar's download button. Works with or without
   * {@link enablePageEditing} (it serializes whatever the document currently
   * is). Defaults to {@link enablePageEditing}.
   */
  showDownloadButton?: boolean;
  /**
   * Show the toolbar's *Annotate* button (right of search), which reveals the
   * annotation toolbar; closing it returns to text selection. Requires the
   * viewer's `interactiveAnnotations` (on by default). Defaults to `true`.
   */
  enableAnnotations?: boolean;
  /** Extra toolbar controls, placed after the built-in ones. */
  children?: ReactNode;
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
  ...providerProps
}: PdfrxViewerAppProps): ReactNode {
  return (
    <PdfrxProvider {...providerProps}>
      <PdfrxViewerAppChrome
        className={className}
        style={style}
        toolbar={toolbar}
        toolbarProps={toolbarProps}
        sidebar={sidebar}
        sidebarProps={sidebarProps}
        sidebarWidth={sidebarWidth}
        sidebarSide={sidebarSide}
        enableFileOpen={enableFileOpen}
        enablePageEditing={enablePageEditing}
        // Each button follows its capability flag unless overridden.
        showOpenButton={showOpenButton ?? enableFileOpen}
        showDownloadButton={showDownloadButton ?? enablePageEditing}
        enableAnnotations={enableAnnotations}
      >
        {children}
      </PdfrxViewerAppChrome>
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
  | 'enableFileOpen'
  | 'enablePageEditing'
  | 'showOpenButton'
  | 'showDownloadButton'
  | 'enableAnnotations'
  | 'children'
>;

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
  enableFileOpen,
  enablePageEditing,
  showOpenButton,
  showDownloadButton,
  enableAnnotations,
  children,
}: ChromeProps): ReactNode {
  const { open, error, clearError } = usePdfDocument();
  const store = usePdfrxStore();
  const viewer = usePdfrxViewer();
  const strings = usePdfrxStrings();
  const { undo, redo, canUndo, canRedo } = useEditHistory();
  const isNarrow = useIsNarrow();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [annotating, setAnnotating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      void open(file).catch((e: unknown) => console.error(`Failed to open ${file.name}:`, e));
    },
    [open],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!enableFileOpen) return;
      const file = [...(e.dataTransfer.files ?? [])].find((f) => isPdfFile(f) || isImageFile(f));
      if (!file) return;
      e.preventDefault();
      openFile(file);
    },
    [enableFileOpen, openFile],
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
          const doc = await openFileAsDocument(engine, file, { passwordProvider: store.passwordProvider });
          inserted.push(...doc.pages);
        } catch (e) {
          console.error(`Failed to open ${file.name} for insertion:`, e);
        }
      }
      if (inserted.length === 0) return;
      const pages = document.pages;
      const at = Math.max(0, Math.min(index, pages.length));
      viewer.setPages([...pages.slice(0, at), ...inserted, ...pages.slice(at)]);
    },
    [viewer, store],
  );

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
    ? (pageNumber: number): ReactNode => <PageActions pageNumber={pageNumber} />
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
        onInsertFiles={enablePageEditing ? (files, index) => void insertFiles(files, index) : undefined}
        onMovePage={enablePageEditing ? movePage : undefined}
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
      onDragOver={enableFileOpen ? (e) => e.preventDefault() : undefined}
      onDrop={onDrop}
    >
      {toolbar && (
        <PdfToolbar
          {...toolbarProps}
          showSidebarToggle={sidebar}
          onToggleSidebar={() => setIsSidebarOpen((previous) => !previous)}
          // Put the hamburger next to the sidebar it controls.
          sidebarTogglePosition={sidebarSide === 'right' ? 'end' : 'start'}
          afterSearch={(enableAnnotations || enablePageEditing) ? (
            <>
              <button
                type="button"
                className="pdfrx-button"
                onClick={() => void undo()}
                disabled={!canUndo}
                title={`${strings.undo} (Ctrl+Z)`}
                aria-label={strings.undo}
              >
                <IconUndo />
              </button>
              <button
                type="button"
                className="pdfrx-button"
                onClick={() => void redo()}
                disabled={!canRedo}
                title={`${strings.redo} (Ctrl+Shift+Z)`}
                aria-label={strings.redo}
              >
                <IconRedo />
              </button>
              {enableAnnotations && (
                <button
                  className={`pdfrx-button${annotating ? ' pdfrx-button-active' : ''}`}
                  aria-pressed={annotating}
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
                title={strings.openFile}
                aria-label={strings.openFile}
              >
                <IconOpenFile />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf,image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // let the same file be picked twice
                  if (file) openFile(file);
                }}
              />
            </>
          )}
          {showDownloadButton && <SaveButton />}
          {children}
        </PdfToolbar>
      )}
      {enableAnnotations && annotating && (
        <div className="pdfrx-toolbar pdfrx-toolbar-annot">
          <PdfAnnotationToolbar onClose={() => setAnnotating(false)} />
        </div>
      )}
      {error !== null && (
        <div className="pdfrx-error" role="alert">
          <span className="pdfrx-error-message">{strings.failedToOpen(describeError(error))}</span>
          <button
            className="pdfrx-button pdfrx-error-dismiss"
            onClick={clearError}
            title={strings.dismissError}
            aria-label={strings.dismissError}
          >
            <IconClose />
          </button>
        </div>
      )}
      <div className="pdfrx-app-body">
        {/* Kept mounted while closed: the drawer animates out on narrow screens,
            and a `display: none` sidebar stops its thumbnails from rendering
            anyway (a hidden element never intersects the viewport). The sidebar
            renders before or after the surface so it lands on the chosen side. */}
        {sidebar && sidebarSide === 'left' && sidebarNode}
        <PdfViewerSurface style={{ flex: 1 }} />
        {sidebar && sidebarSide === 'right' && sidebarNode}
        {sidebar && isSidebarOpen && isNarrow && (
          <button className="pdfrx-scrim" aria-label={strings.closeSidebar} onClick={() => setIsSidebarOpen(false)} />
        )}
      </div>
    </div>
  );
}

/** Rotate and delete buttons drawn over a thumbnail. */
function PageActions({ pageNumber }: { pageNumber: number }): ReactNode {
  const viewer = usePdfrxViewer();
  const strings = usePdfrxStrings();

  // Both edits are synchronous rearrangements of the page list: no worker
  // round-trip and no PDF rebuild until the document is encoded.
  const rotate = (): void => {
    const document = viewer?.document;
    const page = document?.pages[pageNumber - 1];
    if (document && page) viewer?.setPage(pageNumber, page.rotatedCW90());
  };
  const remove = (): void => {
    const document = viewer?.document;
    if (!document || document.pages.length <= 1) return;
    viewer?.setPages(document.pages.filter((p) => p.pageNumber !== pageNumber));
  };

  return (
    <>
      <button className="pdfrx-button" onClick={rotate} title={strings.rotatePage}>
        <IconRotate />
      </button>
      <button className="pdfrx-button pdfrx-danger" onClick={remove} title={strings.deletePage}>
        <IconTrash />
      </button>
    </>
  );
}

/** Serializes the (possibly edited) document and downloads it. */
function SaveButton(): ReactNode {
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
      const data = await document.encodePdfCopy();
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName(sourceName);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to save the document:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <button
      className="pdfrx-button"
      onClick={() => void save()}
      disabled={isSaving || pageCount === 0}
      title={strings.download}
    >
      <IconSave />
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
