import type { PdfOutlineNode, PdfPage } from '@pdfrx/engine';
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

  // Editing pages renumbers them, so everything keyed by page number has to be
  // rebuilt: thumbnails, the outline's destinations, and the page counter.
  viewer.document!.addEventListener('pagesRearranged', () => {
    void buildThumbnails();
    void buildOutline();
    const current = viewer.currentPageNumber;
    pageStatus.textContent = current ? `p.${current} / ${viewer.document?.pages.length ?? 0}` : '';
  });

  // --- Sidebar ---
  thumbCache.clear();
  void buildThumbnails();
  void buildOutline();
}

el.addEventListener('load', onDocumentLoaded);

// While a PDF is opening the viewer paints a spinner instead of the previous
// document; mirror that in the chrome so the toolbar and sidebar can't be used
// on a document that is about to be replaced.
el.addEventListener('loadingchange', (e) => {
  const { isLoading, progress } = (e as CustomEvent).detail as {
    isLoading: boolean;
    progress: { bytesReceived: number; bytesTotal: number | null } | null;
  };
  document.body.classList.toggle('loading', isLoading);
  if (!isLoading) {
    pageStatus.textContent = '';
    return;
  }
  pageStatus.textContent =
    progress && progress.bytesTotal
      ? `Loading… ${Math.round((progress.bytesReceived / progress.bytesTotal) * 100)}%`
      : 'Loading…';
});

el.addEventListener('loadstart', () => {
  // The old document's sidebar is about to be meaningless.
  thumbsPane.textContent = '';
  outlinePane.textContent = '';
  thumbElements.clear();
  thumbCache.clear();
});

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

// --- Narrow-screen chrome: sidebar drawer + collapsible toolbar ---
//
// Both are pure CSS class toggles; the media query in index.html decides
// whether they mean anything.

const main = document.getElementById('main')!;
const header = document.querySelector('header')!;

const isNarrow = (): boolean => window.matchMedia('(max-width: 780px)').matches;
const setSidebarOpen = (open: boolean): void => {
  main.classList.toggle('sidebar-open', open);
};

document.getElementById('menuBtn')!.addEventListener('click', () => {
  setSidebarOpen(!main.classList.contains('sidebar-open'));
});
document.getElementById('moreBtn')!.addEventListener('click', () => header.classList.toggle('tools-open'));
document.getElementById('scrim')!.addEventListener('click', () => setSidebarOpen(false));

/** Closes the drawer after a navigation, so the page is visible right away. */
function closeDrawerIfNarrow(): void {
  if (isNarrow()) setSidebarOpen(false);
}

// Going back to a wide window must not leave the drawer state stuck on.
window.matchMedia('(max-width: 780px)').addEventListener('change', (e) => {
  if (!e.matches) {
    setSidebarOpen(false);
    header.classList.remove('tools-open');
  }
});

// --- Sidebar tabs ---

tabThumbs.addEventListener('click', () => selectTab('thumbs'));
tabOutline.addEventListener('click', () => selectTab('outline'));

function selectTab(tab: 'thumbs' | 'outline'): void {
  tabThumbs.classList.toggle('active', tab === 'thumbs');
  tabOutline.classList.toggle('active', tab === 'outline');
  thumbsPane.style.display = tab === 'thumbs' ? '' : 'none';
  outlinePane.style.display = tab === 'outline' ? '' : 'none';
}

// --- Thumbnails (with drag & drop reordering, rotate and delete) ---

const THUMB_WIDTH = 130;

const thumbElements = new Map<number, HTMLCanvasElement>();
/**
 * Rendered thumbnails, keyed by `PdfPage.renderKey` (source page + rotation).
 * Reordering pages with `setPages` does not change any renderKey, so a reorder
 * repaints the sidebar without re-rendering a single page.
 */
const thumbCache = new Map<string, HTMLCanvasElement>();
let buildToken = 0;

async function thumbCanvasFor(page: PdfPage): Promise<HTMLCanvasElement | null> {
  const cached = thumbCache.get(page.renderKey);
  if (cached) return cached;
  const bitmap = await el.viewer!.renderPageThumbnail(page.pageNumber, THUMB_WIDTH);
  if (!bitmap) return null;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  thumbCache.set(page.renderKey, canvas);
  return canvas;
}

async function buildThumbnails(): Promise<void> {
  const viewer = el.viewer!;
  const doc = viewer.document!;
  const token = ++buildToken;
  thumbsPane.textContent = '';
  thumbElements.clear();
  for (const page of doc.pages) {
    const source = await thumbCanvasFor(page);
    if (token !== buildToken) return; // superseded by a newer build
    if (!source) continue;
    const pageNumber = page.pageNumber;

    const item = document.createElement('div');
    item.className = 'thumb-item';
    item.dataset.pageNumber = `${pageNumber}`;

    // Copy of the cached render, so the same page can appear more than once.
    const canvas = document.createElement('canvas');
    canvas.className = 'thumb';
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    canvas.addEventListener('click', () => {
      if (dragJustEnded) return; // the click that trails a reorder drag
      viewer.goToPage(pageNumber, 300);
      closeDrawerIfNarrow();
    });

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = `${pageNumber}`;

    const tools = document.createElement('div');
    tools.className = 'thumb-tools';
    tools.append(
      toolButton('⟳', 'Rotate 90° clockwise', false, () => rotatePageCW90(pageNumber)),
      toolButton('✕', 'Delete this page', true, () => deletePage(pageNumber)),
    );

    item.append(canvas, tools, label);
    thumbsPane.appendChild(item);
    thumbElements.set(pageNumber, canvas);
  }
  const current = viewer.currentPageNumber;
  for (const [n, img] of thumbElements) img.classList.toggle('current', n === current);
  pruneThumbCache();
}

function toolButton(text: string, title: string, danger: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.title = title;
  if (danger) btn.className = 'danger';
  btn.draggable = false;
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't also navigate to the page
    onClick();
  });
  return btn;
}

/** Drops cached renders no page refers to any more (e.g. the pre-rotation one). */
function pruneThumbCache(): void {
  const live = new Set((el.viewer?.document?.pages ?? []).map((p) => p.renderKey));
  for (const key of [...thumbCache.keys()]) if (!live.has(key)) thumbCache.delete(key);
}

// --- Page editing ---
//
// Every edit is a synchronous `setPages` on the proxy page list: no worker
// round-trip, no PDF rebuild. `encodePdf()` materializes the arrangement when
// the user saves.

function rotatePageCW90(pageNumber: number): void {
  const doc = el.viewer?.document;
  if (!doc) return;
  doc.setPage(pageNumber, doc.pages[pageNumber - 1]!.rotatedCW90());
}

function deletePage(pageNumber: number): void {
  const doc = el.viewer?.document;
  if (!doc) return;
  if (doc.pages.length <= 1) {
    alert('A document must keep at least one page.');
    return;
  }
  doc.setPages(doc.pages.filter((p) => p.pageNumber !== pageNumber));
}

/** Moves the page at `from` (1-based) so it lands before position `before`. */
function movePage(from: number, before: number): void {
  const doc = el.viewer?.document;
  if (!doc) return;
  if (before === from || before === from + 1) return; // no-op
  const pages = [...doc.pages];
  const [moved] = pages.splice(from - 1, 1);
  pages.splice(before > from ? before - 2 : before - 1, 0, moved!);
  doc.setPages(pages);
}

// --- Thumbnail reordering ---
//
// Pointer events rather than HTML5 drag & drop: `dragstart` never fires on
// touch devices. A mouse drag starts as soon as the pointer moves; a touch
// drag needs a long press, so that a plain swipe still scrolls the pane.

const DRAG_HOLD_MS = 300;
const DRAG_THRESHOLD = 5;
const EDGE_SCROLL_ZONE = 40;

interface ThumbDrag {
  pointerId: number;
  from: number;
  item: HTMLElement;
  startY: number;
  active: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
  ghost: HTMLElement | null;
  dropBefore: number | null;
}

let drag: ThumbDrag | null = null;
/** Set while the click that trails a completed drag is still to be delivered. */
let dragJustEnded = false;

function clearDropMarkers(): void {
  for (const item of thumbsPane.querySelectorAll('.thumb-item')) {
    item.classList.remove('drop-before', 'drop-after');
  }
}

/** The pointer may already be gone (or synthetic), which makes capture throw. */
function capturePointer(pointerId: number): void {
  try {
    thumbsPane.setPointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}

function beginDrag(d: ThumbDrag, clientX: number, clientY: number): void {
  d.active = true;
  d.item.classList.add('dragging');
  const ghost = d.item.querySelector('canvas')!.cloneNode(true) as HTMLElement;
  ghost.id = 'thumbGhost';
  ghost.style.width = `${THUMB_WIDTH}px`;
  document.body.appendChild(ghost);
  d.ghost = ghost;
  moveGhost(d, clientX, clientY);
  navigator.vibrate?.(10);
}

function moveGhost(d: ThumbDrag, clientX: number, clientY: number): void {
  if (!d.ghost) return;
  d.ghost.style.left = `${clientX}px`;
  d.ghost.style.top = `${clientY}px`;
}

/** Marks the insertion point under the pointer and records it on the drag. */
function updateDropTarget(d: ThumbDrag, clientY: number): void {
  clearDropMarkers();
  const items = [...thumbsPane.querySelectorAll<HTMLElement>('.thumb-item')];
  let target: HTMLElement | null = null;
  let after = false;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (clientY < rect.bottom) {
      target = item;
      after = clientY > rect.top + rect.height / 2;
      break;
    }
  }
  if (!target) {
    // Past the last thumbnail: append to the end.
    d.dropBefore = items.length + 1;
    items[items.length - 1]?.classList.add('drop-after');
    return;
  }
  target.classList.add(after ? 'drop-after' : 'drop-before');
  d.dropBefore = Number(target.dataset.pageNumber) + (after ? 1 : 0);
}

/** Scrolls the pane when the pointer sits near its top or bottom edge. */
function edgeScroll(clientY: number): void {
  const rect = thumbsPane.getBoundingClientRect();
  if (clientY < rect.top + EDGE_SCROLL_ZONE) thumbsPane.scrollTop -= 10;
  else if (clientY > rect.bottom - EDGE_SCROLL_ZONE) thumbsPane.scrollTop += 10;
}

function endDrag(commit: boolean): void {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.holdTimer !== null) clearTimeout(d.holdTimer);
  d.ghost?.remove();
  d.item.classList.remove('dragging');
  clearDropMarkers();
  if (!d.active) return;
  dragJustEnded = true;
  setTimeout(() => (dragJustEnded = false), 0);
  if (commit && d.dropBefore !== null) movePage(d.from, d.dropBefore);
}

thumbsPane.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('.thumb-tools')) return; // rotate/delete are taps, not drags
  const item = target.closest<HTMLElement>('.thumb-item');
  if (!item) return;
  const d: ThumbDrag = {
    pointerId: e.pointerId,
    from: Number(item.dataset.pageNumber),
    item,
    startY: e.clientY,
    active: false,
    holdTimer: null,
    ghost: null,
    dropBefore: null,
  };
  drag = d;
  if (e.pointerType !== 'mouse') {
    // Long press: a short swipe stays a scroll.
    d.holdTimer = setTimeout(() => {
      d.holdTimer = null;
      if (drag === d) {
        capturePointer(d.pointerId);
        beginDrag(d, e.clientX, e.clientY);
        updateDropTarget(d, e.clientY);
      }
    }, DRAG_HOLD_MS);
  }
});

thumbsPane.addEventListener('pointermove', (e) => {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.active) {
    const moved = Math.abs(e.clientY - d.startY);
    if (d.holdTimer !== null) {
      // Still waiting for the long press — treat real movement as a scroll.
      if (moved > DRAG_THRESHOLD * 2) endDrag(false);
      return;
    }
    if (e.pointerType !== 'mouse' || moved < DRAG_THRESHOLD) return;
    capturePointer(d.pointerId);
    beginDrag(d, e.clientX, e.clientY);
  }
  e.preventDefault();
  moveGhost(d, e.clientX, e.clientY);
  edgeScroll(e.clientY);
  updateDropTarget(d, e.clientY);
});

thumbsPane.addEventListener('pointerup', (e) => {
  if (drag && e.pointerId === drag.pointerId) endDrag(true);
});
thumbsPane.addEventListener('pointercancel', (e) => {
  if (drag && e.pointerId === drag.pointerId) endDrag(false);
});

// --- Save (download) ---

document.getElementById('saveBtn')!.addEventListener('click', async () => {
  const doc = el.viewer?.document;
  if (!doc) return;
  try {
    // Assemble a temporary copy so saving leaves the live arrangement intact.
    const data = await doc.encodePdfCopy();
    // sourceName may be a URL ("uri%http://host/dir/file.pdf") or a file name.
    const name = doc.sourceName.split(/[/\\]/).pop()!.split('?')[0]!.replace(/\.pdf$/i, '') || 'document';
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-edited.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert(`Failed to save: ${err}`);
  }
  // Materializing replaces the PdfPage objects (and their renderKeys).
  void buildThumbnails();
});

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
      item.addEventListener('click', () => {
        viewer.goToDest(node.dest, 300);
        closeDrawerIfNarrow();
      });
      outlinePane.appendChild(item);
      addNodes(node.children, depth + 1);
    }
  };
  addNodes(outline, 0);
}
