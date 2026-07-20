import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { PdfrxProvider, type PdfrxProviderProps } from '../context.js';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { PdfViewerSurface } from '../surface.js';
import { IconOpenFile, IconRotate, IconSave, IconTrash } from './icons.js';
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
  sidebarProps?: Omit<PdfSidebarProps, 'onNavigate' | 'renderPageActions'>;
  /** Sidebar width in CSS pixels. Defaults to `190`. */
  sidebarWidth?: number;
  /**
   * Which side the sidebar sits on. Defaults to `'left'`. On a narrow screen
   * the drawer slides in from this side too.
   */
  sidebarSide?: 'left' | 'right';
  /** Add an "open file" button and accept dropped PDFs. Defaults to `false`. */
  enableFileOpen?: boolean;
  /**
   * Add per-page rotate/delete controls to the sidebar and a download button
   * that serializes the edited document. Defaults to `false`.
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
  children,
}: ChromeProps): ReactNode {
  const { open, error } = usePdfDocument();
  const isNarrow = useIsNarrow();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const file = [...(e.dataTransfer.files ?? [])].find(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (!file) return;
      e.preventDefault();
      openFile(file);
    },
    [enableFileOpen, openFile],
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
        >
          {showOpenButton && (
            <>
              <button
                className="pdfrx-button"
                onClick={() => fileInputRef.current?.click()}
                title="Open a PDF file"
                aria-label="Open a PDF file"
              >
                <IconOpenFile />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
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
      {error !== null && <div className="pdfrx-error">Failed to open the document: {describeError(error)}</div>}
      <div className="pdfrx-app-body">
        {/* Kept mounted while closed: the drawer animates out on narrow screens,
            and a `display: none` sidebar stops its thumbnails from rendering
            anyway (a hidden element never intersects the viewport). The sidebar
            renders before or after the surface so it lands on the chosen side. */}
        {sidebar && sidebarSide === 'left' && sidebarNode}
        <PdfViewerSurface style={{ flex: 1 }} />
        {sidebar && sidebarSide === 'right' && sidebarNode}
        {sidebar && isSidebarOpen && isNarrow && (
          <button className="pdfrx-scrim" aria-label="Close sidebar" onClick={() => setIsSidebarOpen(false)} />
        )}
      </div>
    </div>
  );
}

/** Rotate and delete buttons drawn over a thumbnail. */
function PageActions({ pageNumber }: { pageNumber: number }): ReactNode {
  const viewer = usePdfrxViewer();

  // Both edits are synchronous rearrangements of the page list: no worker
  // round-trip and no PDF rebuild until the document is encoded.
  const rotate = (): void => {
    const document = viewer?.document;
    const page = document?.pages[pageNumber - 1];
    if (document && page) document.setPage(pageNumber, page.rotatedCW90());
  };
  const remove = (): void => {
    const document = viewer?.document;
    if (!document || document.pages.length <= 1) return;
    document.setPages(document.pages.filter((p) => p.pageNumber !== pageNumber));
  };

  return (
    <>
      <button className="pdfrx-button" onClick={rotate} title="Rotate 90° clockwise">
        <IconRotate />
      </button>
      <button className="pdfrx-button pdfrx-danger" onClick={remove} title="Delete this page">
        <IconTrash />
      </button>
    </>
  );
}

/** Serializes the (possibly edited) document and downloads it. */
function SaveButton(): ReactNode {
  const viewer = usePdfrxViewer();
  const { pageCount, sourceName } = usePdfDocument();
  const [isSaving, setIsSaving] = useState(false);

  const save = async (): Promise<void> => {
    const document = viewer?.document;
    if (!document) return;
    setIsSaving(true);
    try {
      // Materializes any proxy arrangement into the PDF, then serializes it.
      const data = await document.encodePdf();
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
    <button className="pdfrx-button" onClick={() => void save()} disabled={isSaving || pageCount === 0} title="Download">
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
