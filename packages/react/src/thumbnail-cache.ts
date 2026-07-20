import type { PdfDocument } from '@pdfrx/engine';
import type { PdfrxViewer } from '@pdfrx/viewer';

/**
 * Caches rendered page thumbnails so a scrolling sidebar does not re-render the
 * same page through the worker over and over.
 *
 * Entries are keyed by {@link PdfPage.renderKey} (source page + rotation) rather
 * than by page number, which is what makes reordering pages free: `setPages`
 * renumbers pages without changing any render key, so the sidebar repaints
 * without a single re-render. Rotating a page *does* change its key, and the
 * now-unreferenced bitmap is dropped by {@link prune}.
 *
 * The cache is per-document: `renderKey` embeds the document handle, and handles
 * are recycled after a document is disposed, so it is cleared whenever the
 * viewer's document instance changes.
 */
export class ThumbnailCache {
  #document: PdfDocument | null = null;
  #canvases = new Map<string, HTMLCanvasElement>();
  #inFlight = new Map<string, Promise<HTMLCanvasElement | null>>();

  /**
   * Returns the thumbnail for `pageNumber`, rendering it if necessary.
   * Concurrent requests for the same key share one render.
   */
  async get(viewer: PdfrxViewer, pageNumber: number, width: number): Promise<HTMLCanvasElement | null> {
    const document = viewer.document;
    if (!document) return null;
    if (document !== this.#document) this.reset(document);

    const page = document.pages[pageNumber - 1];
    if (!page) return null;
    const key = `${page.renderKey}@${width}`;

    const cached = this.#canvases.get(key);
    if (cached) return cached;

    const pending = this.#inFlight.get(key);
    if (pending) return await pending;

    const render = (async (): Promise<HTMLCanvasElement | null> => {
      const bitmap = await viewer.renderPageThumbnail(pageNumber, width);
      if (!bitmap) return null;
      const canvas = window.document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      bitmap.close();
      // A document swap mid-render invalidates the result.
      if (viewer.document === this.#document) this.#canvases.set(key, canvas);
      return canvas;
    })();

    this.#inFlight.set(key, render);
    try {
      return await render;
    } finally {
      this.#inFlight.delete(key);
    }
  }

  /** Drops bitmaps no live page refers to any more (e.g. after a rotation). */
  prune(viewer: PdfrxViewer): void {
    const live = new Set((viewer.document?.pages ?? []).map((p) => p.renderKey));
    for (const key of [...this.#canvases.keys()]) {
      if (!live.has(key.slice(0, key.lastIndexOf('@')))) this.#canvases.delete(key);
    }
  }

  /** Empties the cache and rebinds it to `document`. */
  reset(document: PdfDocument | null = null): void {
    this.#document = document;
    this.#canvases.clear();
    this.#inFlight.clear();
  }
}
