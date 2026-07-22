import { useEffect, useState } from 'react';
import { buildDefaultContextMenu, PdfrxViewerApp, type PdfReactContextMenuBuilder } from '@pdfrx/react';
import { ComposedDemo } from './ComposedDemo.js';
import { HeadlessDemo } from './HeadlessDemo.js';
import './theme.css';

/** Reuse the built-in localized menu and append a "Search the web" item. */
const contextMenuBuilder: PdfReactContextMenuBuilder = (context, { viewer, strings }) => {
  const menu = buildDefaultContextMenu(viewer, strings, context);
  const item = document.createElement('button');
  item.className = 'pdfrx-context-menu-item';
  item.textContent = 'Search the web';
  item.disabled = !context.hasSelection;
  item.addEventListener('click', () => {
    context.close();
    void viewer.selection.getSelectedText().then((text) => {
      if (text) window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank', 'noopener');
    });
  });
  menu.appendChild(item);
  return menu;
};

/** Phone breakpoint: below this the nav sheds its label text. */
const PHONE_MAX_WIDTH = 560;

/** Tracks whether a CSS media query currently matches. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent): void => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** The three layers @pdfrx/react offers, as three tabs. */
const DEMOS = ['all-in-one', 'composed', 'headless'] as const;
type Demo = (typeof DEMOS)[number];
type Theme = 'auto' | 'dark' | 'light';

const LABELS: Record<Demo, string> = {
  'all-in-one': 'All-in-one',
  composed: 'Composed parts',
  headless: 'Headless hooks',
};

/** Language picker options: 'auto' means detect from the browser. */
const LANGS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

export function App() {
  const [demo, setDemo] = useState<Demo>('all-in-one');
  const [lang, setLang] = useState('auto');
  const [theme, setTheme] = useState<Theme>('auto');
  const isPhone = useMediaQuery(`(max-width: ${PHONE_MAX_WIDTH}px)`);

  // 'auto' → undefined, which makes @pdfrx/react detect the browser locale.
  const locale = lang === 'auto' ? undefined : lang;

  return (
    <div
      className="demo-react"
      data-theme={theme}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', font: '13px system-ui, sans-serif' }}
    >
      <nav style={styles.nav}>
        {/* The brand takes room the tabs need on a phone; drop it there. */}
        {!isPhone && <strong style={{ marginInlineEnd: 8 }}>@pdfrx/react</strong>}
        {DEMOS.map((id) => (
          <button
            key={id}
            onClick={() => setDemo(id)}
            style={{ ...styles.tab, ...(id === demo ? styles.tabActive : null) }}
          >
            {LABELS[id]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          style={styles.select}
          title="Color theme"
          aria-label="Color theme"
        >
          <option value="auto">Theme: Auto</option>
          <option value="dark">Theme: Dark</option>
          <option value="light">Theme: Light</option>
        </select>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          style={styles.select}
          title="UI language"
          aria-label="UI language"
        >
          {LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        {/* On a phone: a bare icon, no frame (the title/label still names it). */}
        <a
          style={isPhone ? styles.iconLink : styles.link}
          href="https://github.com/espresso3389/pdfrx_web"
          target="_blank"
          rel="noreferrer"
          title="GitHub repository"
          aria-label="GitHub repository"
        >
          <GitHubIcon />
          {!isPhone && <span>GitHub</span>}
        </a>
        <a
          style={isPhone ? styles.iconLink : styles.link}
          href="https://www.npmjs.com/package/@pdfrx/react"
          target="_blank"
          rel="noreferrer"
          title="@pdfrx/react on npm"
          aria-label="@pdfrx/react on npm"
        >
          <NpmIcon />
          {!isPhone && <span>npm</span>}
        </a>
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
            locale={locale}
            contextMenuBuilder={contextMenuBuilder}
            enableFileOpen
            enablePageEditing
          />
        )}
        {demo === 'composed' && <ComposedDemo key="composed" locale={locale} />}
        {demo === 'headless' && <HeadlessDemo key="headless" />}
      </div>
    </div>
  );
}

/** Inline SVGs so the demo pulls in no icon dependency. */
function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function NpmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
      <path d="M2 2v14h7V5h4v11h3V2H2z" />
    </svg>
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
  select: {
    padding: '5px 6px',
    font: 'inherit',
    color: 'inherit',
    background: '#37474f',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    color: 'inherit',
    textDecoration: 'none',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.25)',
  },
  iconLink: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: 6,
    color: 'inherit',
    textDecoration: 'none',
    border: 0,
  },
} satisfies Record<string, React.CSSProperties>;
