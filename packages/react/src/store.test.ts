import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the real viewer: constructing one boots a pdfium worker and a
 * WASM module, which jsdom cannot do and these tests do not need. Everything
 * below is about the *store's* bookkeeping — who owns the viewer, when it is
 * disposed, and what is invalidated on a document change.
 */
class FakeViewer {
  static instances: FakeViewer[] = [];
  disposeCount = 0;
  openUrlCalls: unknown[] = [];
  openDataCalls: unknown[] = [];
  searcherCount = 0;
  document: unknown = null;
  #documentListeners = new Set<() => void>();
  openUrlError: unknown = null;

  constructor(
    public element: HTMLElement,
    public options: Record<string, unknown>,
  ) {
    FakeViewer.instances.push(this);
  }

  addDocumentChangeListener(listener: () => void): () => void {
    this.#documentListeners.add(listener);
    return () => this.#documentListeners.delete(listener);
  }

  /** Simulates a load completing, the way the real viewer does after openUrl. */
  emitDocumentChange(document: unknown = { pages: [], addEventListener: () => () => {} }): void {
    this.document = document;
    for (const listener of this.#documentListeners) listener();
  }

  createTextSearcher(): { resetTextSearch: () => void; startTextSearch: () => void } {
    this.searcherCount++;
    return { resetTextSearch: () => {}, startTextSearch: () => {} };
  }

  async openUrl(url: string | URL, options: unknown): Promise<void> {
    this.openUrlCalls.push({ url, options });
    if (this.openUrlError) throw this.openUrlError;
    this.emitDocumentChange();
  }

  async openData(data: unknown, options: unknown): Promise<void> {
    this.openDataCalls.push({ data, options });
    this.emitDocumentChange();
  }

  setLayoutDirection(): void {}
  refreshOverlays(): void {}
  refreshViewerOverlays(): void {}
  invalidatePaint(): void {}

  dispose(): void {
    this.disposeCount++;
  }
}

vi.mock('@pdfrx/viewer', () => ({ PdfrxViewer: FakeViewer }));

const { PdfrxViewerStore } = await import('./store.js');

/** Lets the queued microtask in `detach()` run. */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe('PdfrxViewerStore', () => {
  let element: HTMLElement;

  beforeEach(() => {
    FakeViewer.instances = [];
    element = document.createElement('div');
  });

  it('creates the viewer when a surface attaches and disposes it on unmount', async () => {
    const store = new PdfrxViewerStore();
    expect(store.viewer).toBeNull();

    store.attach(element);
    expect(store.viewer).not.toBeNull();
    expect(FakeViewer.instances).toHaveLength(1);

    store.detach();
    await flushMicrotasks();
    expect(store.viewer).toBeNull();
    expect(FakeViewer.instances[0]!.disposeCount).toBe(1);
  });

  it('survives a StrictMode remount without rebuilding the worker', async () => {
    const store = new PdfrxViewerStore();
    // React in development runs: effect, cleanup, effect — synchronously.
    store.attach(element);
    const viewer = store.viewer;
    store.detach();
    store.attach(element);
    await flushMicrotasks();

    expect(store.viewer).toBe(viewer);
    expect(FakeViewer.instances).toHaveLength(1);
    expect(FakeViewer.instances[0]!.disposeCount).toBe(0);
  });

  it('opens the pending source once a surface attaches', async () => {
    const store = new PdfrxViewerStore();
    store.setSource('doc.pdf'); // before any surface exists
    expect(FakeViewer.instances).toHaveLength(0);

    store.attach(element);
    await flushMicrotasks();
    expect(FakeViewer.instances[0]!.openUrlCalls).toHaveLength(1);
  });

  it('ignores an equivalent source so a re-render does not reopen the document', async () => {
    const store = new PdfrxViewerStore();
    store.attach(element);
    store.setSource('doc.pdf');
    store.setSource('doc.pdf');
    store.setSource({ url: 'doc.pdf' });
    await flushMicrotasks();

    expect(FakeViewer.instances[0]!.openUrlCalls).toHaveLength(1);

    store.setSource('other.pdf');
    await flushMicrotasks();
    expect(FakeViewer.instances[0]!.openUrlCalls).toHaveLength(2);
  });

  it('records an open failure and clears it on the next attempt', async () => {
    const store = new PdfrxViewerStore();
    store.attach(element);
    const viewer = FakeViewer.instances[0]!;
    const failure = new Error('404');
    viewer.openUrlError = failure;

    await expect(store.open('missing.pdf')).rejects.toBe(failure);
    expect(store.error).toBe(failure);

    viewer.openUrlError = null;
    await store.open('doc.pdf');
    expect(store.error).toBeNull();
  });

  it('resets the search and the thumbnail cache on a document change', () => {
    const store = new PdfrxViewerStore();
    store.attach(element);
    const viewer = FakeViewer.instances[0]!;
    const searchersAfterAttach = viewer.searcherCount;

    store.setSearchQuery('hello');
    expect(store.searchQuery).toBe('hello');
    expect(store.documentGeneration).toBe(0);

    viewer.emitDocumentChange();

    expect(store.searchQuery).toBe('');
    expect(store.documentGeneration).toBe(1);
    // A fresh searcher: the old one holds matches into pages that are gone.
    expect(viewer.searcherCount).toBe(searchersAfterAttach + 1);
  });

  it('notifies subscribers and stops after unsubscribing', () => {
    const store = new PdfrxViewerStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.attach(element);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const callsBefore = listener.mock.calls.length;
    store.setSearchQuery('hello');
    expect(listener.mock.calls).toHaveLength(callsBefore);
  });

  it('applies option changes to the live viewer instead of recreating it', () => {
    const store = new PdfrxViewerStore();
    store.updateOptions({ backgroundColor: '#fff' });
    store.attach(element);
    const viewer = FakeViewer.instances[0]!;
    expect(viewer.options.backgroundColor).toBe('#fff');

    store.updateOptions({ backgroundColor: '#000' });
    // The viewer reads its options live, so the same object reflects the change.
    expect(viewer.options.backgroundColor).toBe('#000');
    expect(FakeViewer.instances).toHaveLength(1);
  });
});
