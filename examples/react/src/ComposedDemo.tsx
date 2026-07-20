import {
  PdfOutlineTree,
  PdfPageIndicator,
  PdfPrintButton,
  PdfSearchBox,
  PdfThumbnailList,
  PdfViewerSurface,
  PdfZoomControls,
  PdfrxProvider,
  usePdfSelection,
} from '@pdfrx/react';

/**
 * Layer 2: the styled parts, arranged by hand.
 *
 * Nothing here is a fixed layout — the sidebar is split into two independent
 * panes, the toolbar is assembled from individual controls, and a selection
 * status bar sits at the bottom. That is the whole point of this layer: the
 * provider owns the viewer, and where each piece goes is up to the app.
 */
export function ComposedDemo({ locale }: { locale?: string }) {
  return (
    <PdfrxProvider src="hello.pdf" wasmModulesUrl="pdfium/" initialFit="width" locale={locale}>
      <div className="pdfrx-app" style={{ height: '100%' }}>
        <div className="pdfrx-toolbar">
          <PdfPageIndicator />
          <PdfZoomControls />
          <span className="pdfrx-toolbar-spacer" />
          <PdfSearchBox className="pdfrx-toolbar-search" placeholder="Find in document" />
          <PdfPrintButton />
        </div>

        <div className="pdfrx-app-body">
          {/* Both panes at once, instead of the tabbed <PdfSidebar>. */}
          <div className="pdfrx-sidebar" style={{ width: 170 }}>
            <div className="pdfrx-sidebar-pane" style={{ flex: '0 0 45%', borderBottom: '1px solid var(--pdfrx-border)' }}>
              <PdfOutlineTree emptyMessage="No bookmarks" />
            </div>
            <div className="pdfrx-sidebar-pane">
              <PdfThumbnailList width={110} />
            </div>
          </div>
          <PdfViewerSurface style={{ flex: 1 }} />
        </div>

        <SelectionStatus />
      </div>
    </PdfrxProvider>
  );
}

/** Drag over text in the page to see this fill in. */
function SelectionStatus() {
  const { range, text, isResolving, isEmpty, copy } = usePdfSelection();

  return (
    <div style={styles.status}>
      {isEmpty ? (
        <span style={{ opacity: 0.6 }}>Select text in the page…</span>
      ) : (
        <>
          <span style={{ opacity: 0.6 }}>
            {range!.start.pageNumber === range!.end.pageNumber
              ? `p.${range!.start.pageNumber}`
              : `p.${range!.start.pageNumber}–${range!.end.pageNumber}`}
          </span>
          <span style={styles.statusText}>{isResolving ? 'resolving…' : text}</span>
          <button className="pdfrx-button" style={{ width: 'auto', padding: '0 8px' }} onClick={() => void copy()}>
            Copy
          </button>
        </>
      )}
    </div>
  );
}

const styles = {
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',
    height: 30,
    padding: '0 10px',
    fontSize: 12,
    color: 'var(--pdfrx-fg)',
    background: 'var(--pdfrx-bg-subtle)',
    borderTop: '1px solid var(--pdfrx-border)',
  },
  statusText: {
    flex: 1,
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
} satisfies Record<string, React.CSSProperties>;
