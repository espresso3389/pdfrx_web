import type { PdfOutlineNode } from '@pdfrx/engine';
import { definePdfrxViewerElement, type PdfrxViewerElement, type PdfTextSearcher } from '@pdfrx/viewer';

definePdfrxViewerElement();

const el = document.getElementById('viewer') as PdfrxViewerElement;
const searchBox = document.getElementById('searchBox') as HTMLInputElement;
const searchPrev = document.getElementById('searchPrev')!;
const searchNext = document.getElementById('searchNext')!;
const searchStatus = document.getElementById('searchStatus')!;
const printBtn = document.getElementById('printBtn')!;
const pageStatus = document.getElementById('pageStatus')!;
const selStatus = document.getElementById('selStatus')!;
const tabThumbs = document.getElementById('tabThumbs')!;
const tabOutline = document.getElementById('tabOutline')!;
const thumbsPane = document.getElementById('thumbsPane')!;
const outlinePane = document.getElementById('outlinePane')!;

const openFileBtn = document.getElementById('openFileBtn')!;
const openUrlBtn = document.getElementById('openUrlBtn')!;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;

let searcher: PdfTextSearcher | null = null;

function onDocumentLoaded(): void {
  const viewer = el.viewer!;
  console.log(`loaded: ${viewer.document?.sourceName} (${viewer.document?.pages.length} pages)`);

  // --- Search ---
  searchBox.value = '';
  searcher = viewer.createTextSearcher();
  searcher.addListener(updateSearchStatus);
  updateSearchStatus();

  // --- Selection change notification ---
  // The listener gets only the selection *state* (endpoints) synchronously; it
  // resolves text and geometry on demand, mirroring pdfrx.
  let selToken = 0;
  viewer.addSelectionChangeListener((sel) => {
    const token = ++selToken;
    if (sel.isEmpty || !sel.range) {
      selStatus.textContent = '';
      selStatus.title = '';
      return;
    }
    const { start, end } = sel.range;
    const pages = start.pageNumber === end.pageNumber ? `p.${start.pageNumber}` : `p.${start.pageNumber}–${end.pageNumber}`;
    // Cheap: show the range immediately.
    selStatus.textContent = `Selected ${pages}…`;
    // On demand: resolve text + per-page rects (PdfRect).
    void sel.getSelectedTextRanges().then((ranges) => {
      if (token !== selToken) return; // superseded by a newer selection
      const text = ranges.map((r) => r.text).join('\n');
      selStatus.textContent = `Selected ${pages}: ${text}`;
      selStatus.title = text;
      console.log(
        'selection ranges:',
        ranges.map((r) => ({ page: r.pageNumber, start: r.start, end: r.end, bounds: r.bounds })),
      );
    });
  });

  // --- Page-change notification (replaces polling) ---
  viewer.addPageChangeListener((page) => {
    const total = viewer.document?.pages.length ?? 0;
    pageStatus.textContent = page ? `p.${page} / ${total}` : '';
    for (const [n, img] of thumbElements) img.classList.toggle('current', n === page);
  });

  // --- Sidebar ---
  void buildThumbnails();
  void buildOutline();
}

el.addEventListener('load', onDocumentLoaded);

el.addEventListener('error', (e) => {
  console.error('failed to load PDF:', (e as CustomEvent).detail);
});

// --- Open File / Open URL ---

const passwordProvider = (): string | null => window.prompt('This document is password protected.\nPassword:');

// NOTE: the 'load' event fires for every document change (including the
// automatic reopen after font fallback), so open helpers don't need to call
// onDocumentLoaded() themselves.
async function openLocalFile(file: File): Promise<void> {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    await el.viewer!.openData(data, { sourceName: file.name, passwordProvider });
  } catch (e) {
    console.error(e);
    alert(`Failed to open ${file.name}: ${e}`);
  }
}

openFileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openLocalFile(file);
});

openUrlBtn.addEventListener('click', async () => {
  const url = window.prompt('PDF URL:');
  if (!url) return;
  try {
    await el.viewer!.openUrl(url, { passwordProvider });
  } catch (e) {
    console.error(e);
    alert(`Failed to open ${url}: ${e}`);
  }
});

// Drag & drop a PDF file onto the viewer
el.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});
el.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files ?? [])].find(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (file) void openLocalFile(file);
});

// --- Search UI ---

searchBox.addEventListener('input', () => {
  searcher?.startTextSearch(searchBox.value);
});
searchBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (e.shiftKey) void searcher?.goToPrevMatch();
    else void searcher?.goToNextMatch();
  }
});
searchPrev.addEventListener('click', () => void searcher?.goToPrevMatch());
searchNext.addEventListener('click', () => void searcher?.goToNextMatch());

function updateSearchStatus(): void {
  if (!searcher || !searcher.pattern) {
    searchStatus.textContent = '';
    return;
  }
  const current = searcher.currentIndex !== null ? searcher.currentIndex + 1 : 0;
  const suffix = searcher.isSearching ? '…' : '';
  searchStatus.textContent = `${current} / ${searcher.matches.length}${suffix}`;
}

// --- Print ---

printBtn.addEventListener('click', () => void el.viewer?.print());

// --- Fit / Zoom ---

document.getElementById('fitPageBtn')!.addEventListener('click', () => el.viewer?.fitToPage());
document.getElementById('fitWidthBtn')!.addEventListener('click', () => el.viewer?.fitToWidth());
document.getElementById('fitHeightBtn')!.addEventListener('click', () => el.viewer?.fitToHeight());
document.getElementById('zoomInBtn')!.addEventListener('click', () => el.viewer?.zoomUp(undefined, 200));
document.getElementById('zoomOutBtn')!.addEventListener('click', () => el.viewer?.zoomDown(undefined, 200));

// --- Demo page overlays (DOM elements that pan & zoom with the page) ---

let overlaysOn = false;
const overlayBtn = document.getElementById('overlayBtn')!;
overlayBtn.addEventListener('click', () => {
  const v = el.viewer;
  if (!v) return;
  overlaysOn = !overlaysOn;
  overlayBtn.textContent = `Overlay: ${overlaysOn ? 'on' : 'off'}`;
  v.setPageOverlaysBuilder(overlaysOn ? demoOverlaysBuilder : null);
});

// --- Layout direction toggle (vertical <-> horizontal) ---

const layoutBtn = document.getElementById('layoutBtn')!;
layoutBtn.addEventListener('click', () => {
  const v = el.viewer;
  if (!v) return;
  const next = v.layoutDirection === 'vertical' ? 'horizontal' : 'vertical';
  v.setLayoutDirection(next);
  layoutBtn.textContent = `Layout: ${next}`;
});

// Elements are positioned in page-point coordinates; the viewer scales them.
function demoOverlaysBuilder({ pageNumber, pageSize }: { pageNumber: number; pageSize: { width: number; height: number } }) {
  // A badge pinned to the page's top-left corner.
  const badge = document.createElement('div');
  badge.textContent = `Page ${pageNumber}`;
  badge.style.cssText =
    'position:absolute;left:12px;top:12px;padding:4px 10px;border-radius:6px;' +
    'background:rgba(33,150,243,0.9);color:#fff;font:600 14px system-ui;white-space:nowrap;';

  // An interactive button centered horizontally near the bottom.
  const btn = document.createElement('button');
  btn.textContent = 'Click me';
  btn.style.cssText =
    `position:absolute;left:${pageSize.width / 2 - 45}px;top:${pageSize.height - 60}px;` +
    'width:90px;height:32px;border:0;border-radius:6px;cursor:pointer;pointer-events:auto;' +
    'background:#ff9800;color:#fff;font:600 13px system-ui;';
  btn.addEventListener('click', () => alert(`Overlay button on page ${pageNumber} clicked`));

  return [badge, btn];
}

// --- Sidebar tabs ---

tabThumbs.addEventListener('click', () => selectTab('thumbs'));
tabOutline.addEventListener('click', () => selectTab('outline'));

function selectTab(tab: 'thumbs' | 'outline'): void {
  tabThumbs.classList.toggle('active', tab === 'thumbs');
  tabOutline.classList.toggle('active', tab === 'outline');
  thumbsPane.style.display = tab === 'thumbs' ? '' : 'none';
  outlinePane.style.display = tab === 'outline' ? '' : 'none';
}

// --- Thumbnails ---

const thumbElements = new Map<number, HTMLCanvasElement>();

async function buildThumbnails(): Promise<void> {
  const viewer = el.viewer!;
  const doc = viewer.document!;
  thumbsPane.textContent = '';
  thumbElements.clear();
  for (const page of doc.pages) {
    const bitmap = await viewer.renderPageThumbnail(page.pageNumber, 130);
    if (!bitmap) continue;
    const canvas = document.createElement('canvas');
    canvas.className = 'thumb';
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.width = '130px';
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    canvas.addEventListener('click', () => viewer.goToPage(page.pageNumber, 300));
    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = `${page.pageNumber}`;
    thumbsPane.append(canvas, label);
    thumbElements.set(page.pageNumber, canvas);
  }
}

// --- Outline ---

async function buildOutline(): Promise<void> {
  const viewer = el.viewer!;
  const outline = await viewer.loadOutline();
  outlinePane.textContent = '';
  if (outline.length === 0) {
    outlinePane.textContent = '(no outline)';
    return;
  }
  const addNodes = (nodes: readonly PdfOutlineNode[], depth: number): void => {
    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = 'outline-item';
      item.style.paddingLeft = `${depth * 12}px`;
      item.textContent = node.title;
      item.title = node.title;
      item.addEventListener('click', () => viewer.goToDest(node.dest, 300));
      outlinePane.appendChild(item);
      addNodes(node.children, depth + 1);
    }
  };
  addNodes(outline, 0);
}
