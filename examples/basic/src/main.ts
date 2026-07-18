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

async function openLocalFile(file: File): Promise<void> {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    await el.viewer!.openData(data, { sourceName: file.name, passwordProvider });
    onDocumentLoaded();
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
    onDocumentLoaded();
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

// --- Page status ---

setInterval(() => {
  const viewer = el.viewer;
  if (!viewer?.document) return;
  const page = viewer.currentPageNumber;
  pageStatus.textContent = page ? `p.${page} / ${viewer.document.pages.length}` : '';
  for (const [n, img] of thumbElements) {
    img.classList.toggle('current', n === page);
  }
}, 300);

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
    canvas.addEventListener('click', () => viewer.goToPage(page.pageNumber));
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
      item.addEventListener('click', () => viewer.goToDest(node.dest));
      outlinePane.appendChild(item);
      addNodes(node.children, depth + 1);
    }
  };
  addNodes(outline, 0);
}
