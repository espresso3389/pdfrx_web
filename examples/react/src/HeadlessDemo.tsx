import { useState } from 'react';
import {
  PdfViewerSurface,
  PdfrxProvider,
  useFormFields,
  usePdfDocument,
  usePdfNavigation,
  usePdfOutline,
  usePdfSearch,
  usePdfZoom,
} from '@pdfrx/react';

/** Sample documents the headless demo can switch between. */
const SOURCES = [
  { src: 'form.pdf', label: 'Form' },
  { src: 'hello.pdf', label: 'Hello' },
] as const;

/**
 * Layer 1: hooks only.
 *
 * Not a single component or class name from the package is used below — the
 * markup and styling are entirely this file's. `@pdfrx/react/styles.css` is not
 * even needed for this tab.
 */
export function HeadlessDemo() {
  const [src, setSrc] = useState<string>(SOURCES[0].src);
  return (
    // key={src} remounts the provider so a source switch reopens cleanly.
    <PdfrxProvider key={src} src={src} wasmModulesUrl="pdfium/">
      <div style={styles.root}>
        <Chrome src={src} setSrc={setSrc} />
        <div style={styles.body}>
          <OwnOutline />
          <PdfViewerSurface style={{ flex: 1, minWidth: 0 }} />
          <FormPanel />
        </div>
      </div>
    </PdfrxProvider>
  );
}

function Chrome({ src, setSrc }: { src: string; setSrc: (s: string) => void }) {
  const { pageCount, isLoading, progress } = usePdfDocument();
  const { currentPageNumber, goToPreviousPage, goToNextPage, canGoPrevious, canGoNext } = usePdfNavigation();
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = usePdfZoom();
  const { query, setQuery, currentIndex, matchCount, isSearching, goToNext, goToPrevious } = usePdfSearch();

  const picker = (
    <select value={src} onChange={(e) => setSrc(e.target.value)} style={{ font: 'inherit', padding: '2px 6px' }}>
      {SOURCES.map((s) => (
        <option key={s.src} value={s.src}>
          {s.label}
        </option>
      ))}
    </select>
  );

  if (isLoading) {
    const percent = progress?.bytesTotal ? Math.round((progress.bytesReceived / progress.bytesTotal) * 100) : null;
    return (
      <div style={styles.bar}>
        {picker}
        <span>Loading{percent === null ? '…' : ` ${percent}%`}</span>
      </div>
    );
  }

  return (
    <div style={styles.bar}>
      {picker}
      <span style={styles.divider} />
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

/**
 * A form-fields editor built entirely on `useFormFields`: read every field's
 * value, set it, and stay in sync when the user edits a field on the canvas.
 */
function FormPanel() {
  const { fields, setValue, isLoading } = useFormFields();

  if (isLoading && fields.length === 0) return null;
  if (fields.length === 0) return null;

  return (
    <div style={styles.form}>
      <div style={styles.formTitle}>Form fields</div>
      {fields.map((f) => {
        if (f.type === 'checkBox') {
          return (
            <label key={f.name} style={styles.formRow}>
              <input
                type="checkbox"
                checked={!!f.isChecked}
                onChange={(e) => void setValue(f.name, e.target.checked)}
              />
              <span>{f.name}</span>
            </label>
          );
        }
        if (f.type === 'radioButton') {
          return (
            <div key={f.name} style={styles.formRow}>
              <span style={styles.formLabel}>{f.name}</span>
              <span>
                {f.options?.map((o) => (
                  <label key={o.label} style={{ marginInlineEnd: 8 }}>
                    <input
                      type="radio"
                      name={f.name}
                      checked={o.selected}
                      onChange={() => void setValue(f.name, o.label)}
                    />
                    {o.label}
                  </label>
                ))}
              </span>
            </div>
          );
        }
        if (f.type === 'comboBox' || f.type === 'listBox') {
          return (
            <label key={f.name} style={styles.formRow}>
              <span style={styles.formLabel}>{f.name}</span>
              <select value={f.value} onChange={(e) => void setValue(f.name, e.target.value)}>
                {f.options?.map((o) => (
                  <option key={o.label} value={o.label}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (f.type === 'textField') {
          // Read-only fields (e.g. a calculated total) show disabled.
          return (
            <label key={f.name} style={styles.formRow}>
              <span style={styles.formLabel}>{f.name}</span>
              <input
                value={f.value}
                disabled={f.flags.readOnly}
                onChange={(e) => void setValue(f.name, e.target.value)}
                style={{ font: 'inherit', flex: 1, minWidth: 0, background: f.flags.readOnly ? '#eee' : undefined }}
              />
            </label>
          );
        }
        return null;
      })}
    </div>
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
  form: {
    width: 230,
    flex: '0 0 auto',
    padding: '10px 12px',
    overflow: 'auto',
    background: '#fafafa',
    borderInlineStart: '1px solid #cfd8dc',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  formTitle: { fontWeight: 600, fontSize: 13 },
  formRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  formLabel: { minWidth: 64 },
} satisfies Record<string, React.CSSProperties>;
