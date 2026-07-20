import {
  PdfViewerSurface,
  PdfrxProvider,
  usePdfDocument,
  usePdfNavigation,
  usePdfOutline,
  usePdfSearch,
  usePdfZoom,
} from '@pdfrx/react';

/**
 * Layer 1: hooks only.
 *
 * Not a single component or class name from the package is used below — the
 * markup and styling are entirely this file's. `@pdfrx/react/styles.css` is not
 * even needed for this tab.
 */
export function HeadlessDemo() {
  return (
    <PdfrxProvider src="hello.pdf" wasmModulesUrl="pdfium/">
      <div style={styles.root}>
        <Chrome />
        <div style={styles.body}>
          <OwnOutline />
          <PdfViewerSurface style={{ flex: 1, minWidth: 0 }} />
        </div>
      </div>
    </PdfrxProvider>
  );
}

function Chrome() {
  const { pageCount, isLoading, progress } = usePdfDocument();
  const { currentPageNumber, goToPreviousPage, goToNextPage, canGoPrevious, canGoNext } = usePdfNavigation();
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = usePdfZoom();
  const { query, setQuery, currentIndex, matchCount, isSearching, goToNext, goToPrevious } = usePdfSearch();

  if (isLoading) {
    const percent = progress?.bytesTotal ? Math.round((progress.bytesReceived / progress.bytesTotal) * 100) : null;
    return <div style={styles.bar}>Loading{percent === null ? '…' : ` ${percent}%`}</div>;
  }

  return (
    <div style={styles.bar}>
      <button onClick={() => goToPreviousPage(200)} disabled={!canGoPrevious}>
        ‹
      </button>
      <span style={styles.mono}>
        {currentPageNumber ?? '–'} / {pageCount}
      </span>
      <button onClick={() => goToNextPage(200)} disabled={!canGoNext}>
        ›
      </button>

      <span style={styles.divider} />

      <button onClick={() => zoomOut()} disabled={!canZoomOut}>
        −
      </button>
      <span style={styles.mono}>{Math.round(zoom * 100)}%</span>
      <button onClick={() => zoomIn()} disabled={!canZoomIn}>
        +
      </button>

      <span style={styles.divider} />

      <input
        value={query}
        placeholder="search"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          void (e.shiftKey ? goToPrevious() : goToNext());
        }}
        style={{ font: 'inherit', padding: '2px 6px' }}
      />
      {query && (
        <span style={styles.mono}>
          {(currentIndex ?? -1) + 1} / {matchCount}
          {isSearching ? '…' : ''}
        </span>
      )}
    </div>
  );
}

/** A flat outline list, to show `usePdfOutline` + `goToDest` without a tree UI. */
function OwnOutline() {
  const { outline, isLoading } = usePdfOutline();
  const { goToDest } = usePdfNavigation();

  if (isLoading || !outline?.length) return null;
  return (
    <ul style={styles.outline}>
      {outline.map((node, i) => (
        <li key={i}>
          <button style={styles.outlineItem} onClick={() => goToDest(node.dest, 300)}>
            {node.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto',
    padding: '6px 10px',
    background: '#eceff1',
    borderBottom: '1px solid #cfd8dc',
  },
  mono: { fontVariantNumeric: 'tabular-nums', minWidth: '3.5em', textAlign: 'center' },
  divider: { width: 1, alignSelf: 'stretch', background: '#cfd8dc', margin: '0 4px' },
  outline: {
    width: 180,
    margin: 0,
    padding: '6px 0',
    listStyle: 'none',
    overflow: 'auto',
    background: '#fafafa',
    borderInlineEnd: '1px solid #cfd8dc',
  },
  outlineItem: {
    display: 'block',
    width: '100%',
    padding: '5px 10px',
    font: 'inherit',
    textAlign: 'start',
    background: 'none',
    border: 0,
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>;
