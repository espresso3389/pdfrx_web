import { useState } from 'react';
import { PdfrxViewerApp } from '@pdfrx/react';
import { ComposedDemo } from './ComposedDemo.js';
import { HeadlessDemo } from './HeadlessDemo.js';

/** The three layers @pdfrx/react offers, as three tabs. */
const DEMOS = ['all-in-one', 'composed', 'headless'] as const;
type Demo = (typeof DEMOS)[number];

const LABELS: Record<Demo, string> = {
  'all-in-one': 'All-in-one',
  composed: 'Composed parts',
  headless: 'Headless hooks',
};

export function App() {
  const [demo, setDemo] = useState<Demo>('all-in-one');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', font: '13px system-ui, sans-serif' }}>
      <nav style={styles.nav}>
        <strong style={{ marginInlineEnd: 8 }}>@pdfrx/react</strong>
        {DEMOS.map((id) => (
          <button
            key={id}
            onClick={() => setDemo(id)}
            style={{ ...styles.tab, ...(id === demo ? styles.tabActive : null) }}
          >
            {LABELS[id]}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* Keyed so switching tabs tears the old viewer down rather than
            reparenting it — three live pdfium workers is not what a demo wants. */}
        {demo === 'all-in-one' && (
          <PdfrxViewerApp
            key="all-in-one"
            src="hello.pdf"
            wasmModulesUrl="pdfium/"
            style={{ height: '100%' }}
            enableFileOpen
            enablePageEditing
          />
        )}
        {demo === 'composed' && <ComposedDemo key="composed" />}
        {demo === 'headless' && <HeadlessDemo key="headless" />}
      </div>
    </div>
  );
}

const styles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 10px',
    background: '#263238',
    color: '#eceff1',
  },
  tab: {
    padding: '5px 10px',
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  tabActive: {
    background: '#2196f3',
    borderColor: '#2196f3',
  },
} satisfies Record<string, React.CSSProperties>;
