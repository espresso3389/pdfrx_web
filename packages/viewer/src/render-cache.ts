/**
 * Page bitmap cache.
 *
 * Strategy:
 *
 * - Each page has one *base* bitmap rendered at a capped scale, redrawn when
 *   the required scale drifts past a threshold.
 * - When the view is zoomed beyond the cap, a *sharp patch* covering (part of)
 *   the visible region is rendered at the true scale and drawn on top. Patches
 *   are keyed by their document-space rect, so a stale patch still draws at
 *   the correct position — it is merely lower resolution until replaced.
 */

import type { PdfAnnotationRenderingMode, PdfDocument, PdfPageRenderCancellationToken } from '@pdfrx/engine';
import { rectHeight, rectWidth, type Rect } from '@pdfrx/viewer-core';

interface BaseBitmap {
  scale: number;
  bitmap: ImageBitmap;
}

interface Patch {
  /** Document-space rect the bitmap covers. */
  rect: Rect;
  scale: number;
  bitmap: ImageBitmap;
}

/** A base render that has been queued, and the token that can drop it. */
interface InFlight {
  scale: number;
  task: RenderTask;
}

/** @internal Settled outcome of one concrete cache render request. */
export type RenderRequestResult =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled'; readonly reason: string }
  | { readonly status: 'failed'; readonly error: unknown };

interface ScheduledTask {
  readonly result: Promise<'elapsed' | 'cancelled'>;
  cancel(): void;
}

interface PendingPatch {
  visibleDocRect: Rect;
  pageRect: Rect;
  scale: number;
  task: ScheduledTask;
  result: Promise<RenderRequestResult>;
}

interface PatchInFlight {
  visibleDocRect: Rect;
  pageRect: Rect;
  scale: number;
  task: RenderTask;
}

interface RenderTask {
  readonly token: PdfPageRenderCancellationToken;
  readonly result: Promise<RenderRequestResult>;
  readonly settled: boolean;
  finish(result: RenderRequestResult): void;
  cancel(reason: string): void;
}

const scheduleTask = (delay: number): ScheduledTask => {
  let settle!: (result: 'elapsed' | 'cancelled') => void;
  let settled = false;
  const result = new Promise<'elapsed' | 'cancelled'>((resolve) => { settle = resolve; });
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    settle('elapsed');
  }, delay);
  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle('cancelled');
    },
  };
};

const createRenderTask = (token: PdfPageRenderCancellationToken): RenderTask => {
  let settle!: (result: RenderRequestResult) => void;
  let settled = false;
  const result = new Promise<RenderRequestResult>((resolve) => { settle = resolve; });
  return {
    token,
    result,
    get settled() { return settled; },
    finish: (outcome) => {
      if (settled) return;
      settled = true;
      settle(outcome);
    },
    cancel: (reason) => {
      if (settled) return;
      settled = true;
      token.cancel();
      settle({ status: 'cancelled', reason });
    },
  };
};

const sameRect = (a: Rect, b: Rect): boolean =>
  a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/** Pixel budget for a base (whole page) bitmap. */
const BASE_PIXEL_BUDGET = 4 * 1024 * 1024;
/** Re-render the base when the required scale exceeds the cached by this ratio. */
const SCALE_TOLERANCE = 1.4;
/** Max pixels for one sharp patch. */
const PATCH_PIXEL_BUDGET = 6 * 1024 * 1024;

/**
 * @internal
 * Per-page bitmap cache owned by {@link PdfrxViewer}. Not part of the public
 * API. Renders each page once at a capped scale and overlays a sharp,
 * true-scale patch of the visible region when zoomed in, then hands the
 * bitmaps back to the viewer's paint loop. See the module doc for the strategy.
 */
export class PageRenderCache {
  /**
   * @param doc - The open document to render pages from.
   * @param onUpdate - Called after a bitmap finishes, to request a repaint.
   * @param annotationRenderingMode - Returns the annotation-rendering mode for
   *   canvas renders. The viewer passes `'formsOnly'` while it paints
   *   annotations through the SVG overlay, so they are not drawn twice; returns
   *   `undefined` to keep the engine default (`'annotationAndForms'`).
   */
  constructor(
    private readonly doc: PdfDocument,
    private readonly onUpdate: () => void,
    private readonly annotationRenderingMode: () => PdfAnnotationRenderingMode | undefined = () => undefined,
  ) {}

  // Base bitmaps are keyed by `PdfPage.renderKey` (source page + rotation), not
  // by page number, so rearranging the document with `PdfDocument.setPages`
  // keeps every rendered page — only pages whose rotation actually changed are
  // re-rendered. Patches are transient and visible-region-only, so they stay
  // keyed by page number and are dropped on rearrangement.
  private readonly base = new Map<string, BaseBitmap>();
  private readonly baseRendering = new Map<string, InFlight>(); // renderKey -> render in progress
  private readonly patches = new Map<number, Patch>();
  private readonly patchRendering = new Map<number, PatchInFlight>();
  /** Per-page debounce keeps every deterministically visible region requestable. */
  private readonly pendingPatches = new Map<number, PendingPatch>();
  private disposed = false;

  /** Render key of the page currently at `pageNumber`, or null if there is none. */
  private keyOf(pageNumber: number): string | null {
    return this.doc.pages[pageNumber - 1]?.renderKey ?? null;
  }

  /** @internal Current base (whole-page) bitmap for a page, if rendered. */
  getBase(pageNumber: number): BaseBitmap | undefined {
    const key = this.keyOf(pageNumber);
    return key === null ? undefined : this.base.get(key);
  }

  /** @internal Current sharp patch for a page, if one has been rendered. */
  getPatch(pageNumber: number): Patch | undefined {
    return this.patches.get(pageNumber);
  }

  /**
   * @internal Whether the page bitmap currently drawn for this viewport has
   * reached the cache's full-quality target.
   */
  isReady(pageNumber: number, visibleDocRect: Rect, requiredScale: number): boolean {
    const base = this.getBase(pageNumber);
    const baseTarget = Math.min(requiredScale, this.baseScaleCap(pageNumber));
    if (!base || base.scale < baseTarget / SCALE_TOLERANCE) return false;

    // Above the whole-page pixel cap, the visible area needs an exact-scale
    // patch. The base remains useful as an immediate placeholder underneath.
    if (requiredScale <= this.baseScaleCap(pageNumber) * 1.1) return true;
    const patch = this.getPatch(pageNumber);
    return patch !== undefined &&
      patch.scale === requiredScale &&
      patch.rect.left <= visibleDocRect.left &&
      patch.rect.top <= visibleDocRect.top &&
      patch.rect.right >= visibleDocRect.right &&
      patch.rect.bottom >= visibleDocRect.bottom;
  }

  /** @internal Cap the scale so the whole page stays within the pixel budget. */
  baseScaleCap(pageNumber: number): number {
    const page = this.doc.pages[pageNumber - 1]!;
    return Math.sqrt(BASE_PIXEL_BUDGET / (page.width * page.height));
  }

  /** @internal Ensure the base bitmap for a page approaches the required scale. */
  requestBase(pageNumber: number, requiredScale: number): Promise<RenderRequestResult> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled', reason: 'disposed' });
    const key = this.keyOf(pageNumber);
    if (key === null) return Promise.resolve({ status: 'cancelled', reason: 'page-unavailable' });
    const scale = Math.min(requiredScale, this.baseScaleCap(pageNumber));
    const cached = this.base.get(key);
    if (cached && cached.scale >= scale / SCALE_TOLERANCE) return Promise.resolve({ status: 'completed' });
    let rendering = this.baseRendering.get(key);
    if (rendering?.task.settled) {
      this.baseRendering.delete(key);
      rendering = undefined;
    }
    if (rendering && rendering.scale >= scale / SCALE_TOLERANCE) return rendering.task.result;
    // A render for this page is already queued, but at too low a scale to be
    // worth waiting for: drop it rather than rendering the page twice.
    rendering?.task.cancel('replaced');

    const page = this.doc.pages[pageNumber - 1];
    if (!page) return Promise.resolve({ status: 'cancelled', reason: 'page-unavailable' });
    const token = page.createCancellationToken();
    const task = createRenderTask(token);
    this.baseRendering.set(key, { scale, task });
    void this.renderBase(pageNumber, key, scale, task);
    return task.result;
  }

  /**
   * @internal
   * Cancels queued base renders whose page is not in `keys`. Called from the
   * paint loop so pages scrolled past give up their place in the queue to the
   * pages now on screen — the whole point of queueing renders client-side.
   */
  cancelBasesExcept(keys: ReadonlySet<string>): void {
    for (const [key, inFlight] of this.baseRendering) {
      if (keys.has(key)) continue;
      inFlight.task.cancel('scrolled-away');
      this.baseRendering.delete(key);
    }
  }

  private async renderBase(
    pageNumber: number,
    key: string,
    scale: number,
    task: RenderTask,
  ): Promise<void> {
    try {
      const page = this.doc.pages[pageNumber - 1];
      // The page may have been moved away from this slot while we waited.
      if (!page || page.renderKey !== key) {
        task.finish({ status: 'cancelled', reason: 'page-moved' });
        return;
      }
      const image = await page.render({
        fullWidth: Math.ceil(page.width * scale),
        fullHeight: Math.ceil(page.height * scale),
        annotationRenderingMode: this.annotationRenderingMode(),
        cancellationToken: task.token,
      });
      if (!image || this.disposed || task.settled) {
        task.finish({ status: 'cancelled', reason: this.disposed ? 'disposed' : 'cancelled' });
        return;
      }
      const bitmap = await image.toImageBitmap();
      if (this.disposed || task.settled) {
        bitmap.close();
        task.finish({ status: 'cancelled', reason: this.disposed ? 'disposed' : 'cancelled' });
        return;
      }
      this.base.get(key)?.bitmap.close();
      this.base.set(key, { scale, bitmap });
      this.onUpdate();
      task.finish({ status: 'completed' });
    } catch (e) {
      if (task.settled) return;
      console.error(`Failed to render page ${pageNumber}:`, e);
      task.finish({ status: 'failed', error: e });
    } finally {
      // Only clear the slot if it is still ours; a newer, higher-scale render
      // may have replaced it while this one was cancelled.
      if (this.baseRendering.get(key)?.task === task) this.baseRendering.delete(key);
    }
  }

  /**
   * @internal
   * Schedule (debounced) a sharp patch render for the visible part of a page.
   * `visibleDocRect` is the intersection of the visible rect and the page rect,
   * in document coordinates; `pageRect` is the page's layout rect; `scale` is
   * the true on-screen pixel density (zoom * devicePixelRatio).
   */
  schedulePatch(
    pageNumber: number,
    visibleDocRect: Rect,
    pageRect: Rect,
    scale: number,
  ): Promise<RenderRequestResult> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled', reason: 'disposed' });
    const existing = this.patches.get(pageNumber);
    if (
      existing &&
      existing.scale === scale &&
      existing.rect.left <= visibleDocRect.left &&
      existing.rect.top <= visibleDocRect.top &&
      existing.rect.right >= visibleDocRect.right &&
      existing.rect.bottom >= visibleDocRect.bottom
    ) {
      return Promise.resolve({ status: 'completed' }); // current patch still covers the view at this scale
    }
    let rendering = this.patchRendering.get(pageNumber);
    if (rendering?.task.settled) {
      this.patchRendering.delete(pageNumber);
      rendering = undefined;
    }
    if (rendering && rendering.scale === scale &&
      sameRect(rendering.visibleDocRect, visibleDocRect) && sameRect(rendering.pageRect, pageRect)) {
      return rendering.task.result;
    }
    const pending = this.pendingPatches.get(pageNumber);
    if (pending && pending.scale === scale &&
      sameRect(pending.visibleDocRect, visibleDocRect) && sameRect(pending.pageRect, pageRect)) {
      return pending.result;
    }
    pending?.task.cancel();
    const task = scheduleTask(150);
    const result = task.result.then((scheduled): Promise<RenderRequestResult> | RenderRequestResult => {
      if (this.pendingPatches.get(pageNumber)?.task === task) this.pendingPatches.delete(pageNumber);
      if (scheduled === 'cancelled') return { status: 'cancelled', reason: 'debounce-cancelled' };
      return this.requestPatch(pageNumber, visibleDocRect, pageRect, scale);
    });
    this.pendingPatches.set(pageNumber, {
      visibleDocRect: { ...visibleDocRect },
      pageRect: { ...pageRect },
      scale,
      task,
      result,
    });
    return result;
  }

  /** @internal Drop and close patches for pages no longer visible. */
  clearPatchesExcept(pageNumbers: ReadonlySet<number>): void {
    for (const [pageNumber, patch] of this.patches) {
      if (!pageNumbers.has(pageNumber)) {
        patch.bitmap.close();
        this.patches.delete(pageNumber);
      }
    }
    for (const [pageNumber, rendering] of this.patchRendering) {
      if (pageNumbers.has(pageNumber)) continue;
      rendering.task.cancel('scrolled-away');
      this.patchRendering.delete(pageNumber);
    }
    // Patches scheduled for pages that have since scrolled away are pointless.
    for (const [pageNumber, pending] of this.pendingPatches) {
      if (pageNumbers.has(pageNumber)) continue;
      pending.task.cancel();
      this.pendingPatches.delete(pageNumber);
    }
  }

  private requestPatch(
    pageNumber: number,
    visibleDocRect: Rect,
    pageRect: Rect,
    scale: number,
  ): Promise<RenderRequestResult> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled', reason: 'disposed' });
    const rendering = this.patchRendering.get(pageNumber);
    if (rendering && !rendering.task.settled && rendering.scale === scale &&
      sameRect(rendering.visibleDocRect, visibleDocRect) && sameRect(rendering.pageRect, pageRect)) {
      return rendering.task.result;
    }
    // A patch for this page is already queued for a view the user has since
    // moved on from; drop it and render what is on screen now.
    rendering?.task.cancel('replaced');
    this.patchRendering.delete(pageNumber);

    // Inflate the patch a bit so small pans don't immediately invalidate it,
    // then clamp to the page and the pixel budget.
    let rect: Rect = {
      left: Math.max(visibleDocRect.left - 100, pageRect.left),
      top: Math.max(visibleDocRect.top - 100, pageRect.top),
      right: Math.min(visibleDocRect.right + 100, pageRect.right),
      bottom: Math.min(visibleDocRect.bottom + 100, pageRect.bottom),
    };
    if (rectWidth(rect) * scale * (rectHeight(rect) * scale) > PATCH_PIXEL_BUDGET) {
      rect = visibleDocRect;
    }
    if (rectWidth(rect) < 1 || rectHeight(rect) < 1) return Promise.resolve({ status: 'completed' });

    const page = this.doc.pages[pageNumber - 1];
    if (!page) return Promise.resolve({ status: 'cancelled', reason: 'page-unavailable' });
    const token = page.createCancellationToken();
    const task = createRenderTask(token);
    this.patchRendering.set(pageNumber, {
      visibleDocRect: { ...visibleDocRect },
      pageRect: { ...pageRect },
      scale,
      task,
    });
    void this.renderPatch(pageNumber, pageRect, scale, rect, task);
    return task.result;
  }

  private async renderPatch(
    pageNumber: number,
    pageRect: Rect,
    scale: number,
    rect: Rect,
    task: RenderTask,
  ): Promise<void> {
    try {
      const page = this.doc.pages[pageNumber - 1];
      if (!page) {
        task.finish({ status: 'cancelled', reason: 'page-unavailable' });
        return;
      }
      const pageScaleX = rectWidth(pageRect) / page.width;
      const fullWidth = Math.ceil(page.width * pageScaleX * scale);
      const fullHeight = Math.ceil(page.height * pageScaleX * scale);
      const x = Math.floor((rect.left - pageRect.left) * scale);
      const y = Math.floor((rect.top - pageRect.top) * scale);
      const width = Math.ceil(rectWidth(rect) * scale);
      const height = Math.ceil(rectHeight(rect) * scale);
      const image = await page.render({
        x,
        y,
        width,
        height,
        fullWidth,
        fullHeight,
        annotationRenderingMode: this.annotationRenderingMode(),
        cancellationToken: task.token,
      });
      if (!image || this.disposed || task.settled) {
        task.finish({ status: 'cancelled', reason: this.disposed ? 'disposed' : 'cancelled' });
        return;
      }
      const bitmap = await image.toImageBitmap();
      if (this.disposed || task.settled) {
        bitmap.close();
        task.finish({ status: 'cancelled', reason: this.disposed ? 'disposed' : 'cancelled' });
        return;
      }
      // Snap the stored rect to the actual pixel origin used for rendering.
      const snapped: Rect = {
        left: pageRect.left + x / scale,
        top: pageRect.top + y / scale,
        right: pageRect.left + (x + width) / scale,
        bottom: pageRect.top + (y + height) / scale,
      };
      this.patches.get(pageNumber)?.bitmap.close();
      this.patches.set(pageNumber, { rect: snapped, scale, bitmap });
      this.onUpdate();
      task.finish({ status: 'completed' });
    } catch (e) {
      if (task.settled) return;
      console.error(`Failed to render patch for page ${pageNumber}:`, e);
      task.finish({ status: 'failed', error: e });
    } finally {
      if (this.patchRendering.get(pageNumber)?.task === task) this.patchRendering.delete(pageNumber);
    }
  }

  /**
   * @internal
   * Called after the document's page arrangement changed. Base bitmaps survive —
   * that is the point of keying them by content — but patches are tied to page
   * positions, and bitmaps for pages that are no longer present are evicted.
   */
  onArrangementChanged(): void {
    for (const { bitmap } of this.patches.values()) bitmap.close();
    this.patches.clear();
    this.cancelPatchRenders();

    const live = new Set(this.doc.pages.map((p) => p.renderKey));
    for (const [key, { bitmap }] of this.base) {
      if (!live.has(key)) {
        bitmap.close();
        this.base.delete(key);
      }
    }
    // Renders queued for a page that is no longer in the document are wasted.
    for (const [key, inFlight] of this.baseRendering) {
      if (!live.has(key)) inFlight.task.cancel('page-removed');
    }
  }

  /** @internal Drops rendered and queued work for the specified page positions. */
  clearPages(pageNumbers: readonly number[]): void {
    const pageSet = new Set(pageNumbers);
    const keys = new Set(
      pageNumbers
        .map((pageNumber) => this.keyOf(pageNumber))
        .filter((key): key is string => key !== null),
    );
    for (const key of keys) {
      this.base.get(key)?.bitmap.close();
      this.base.delete(key);
      this.baseRendering.get(key)?.task.cancel('page-invalidated');
      this.baseRendering.delete(key);
    }
    for (const pageNumber of pageSet) {
      this.patches.get(pageNumber)?.bitmap.close();
      this.patches.delete(pageNumber);
      this.patchRendering.get(pageNumber)?.task.cancel('page-invalidated');
      this.patchRendering.delete(pageNumber);
    }
    for (const pageNumber of pageSet) {
      this.pendingPatches.get(pageNumber)?.task.cancel();
      this.pendingPatches.delete(pageNumber);
    }
  }

  /** @internal Drops all rendered bitmaps (e.g. after font registration changed glyphs). */
  clearAllRendered(): void {
    for (const { bitmap } of this.base.values()) bitmap.close();
    for (const { bitmap } of this.patches.values()) bitmap.close();
    this.base.clear();
    this.patches.clear();
    // In-flight renders were made with the old glyphs — drop them too.
    for (const { task } of this.baseRendering.values()) task.cancel('cache-invalidated');
    this.baseRendering.clear();
    this.cancelPatchRenders();
  }

  /**
   * @internal
   * Drops every queued render but keeps the bitmaps already rendered. Used when
   * a new document starts opening, so the worker is not still chewing through
   * renders for the document being replaced.
   */
  cancelAllPending(): void {
    for (const { task } of this.baseRendering.values()) task.cancel('pending-cancelled');
    this.cancelPatchRenders();
  }

  private cancelPatchRenders(): void {
    for (const rendering of this.patchRendering.values()) rendering.task.cancel('pending-cancelled');
    this.patchRendering.clear();
    for (const pending of this.pendingPatches.values()) pending.task.cancel();
    this.pendingPatches.clear();
  }

  /** @internal Closes every cached bitmap and stops accepting new renders. */
  dispose(): void {
    this.disposed = true;
    for (const { task } of this.baseRendering.values()) task.cancel('disposed');
    this.baseRendering.clear();
    this.cancelPatchRenders();
    for (const { bitmap } of this.base.values()) bitmap.close();
    for (const { bitmap } of this.patches.values()) bitmap.close();
    this.base.clear();
    this.patches.clear();
  }
}
