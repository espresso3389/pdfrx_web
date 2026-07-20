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

import type { PdfDocument, PdfPageRenderCancellationToken } from '@pdfrx/engine';
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
  token: PdfPageRenderCancellationToken;
}

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
   */
  constructor(
    private readonly doc: PdfDocument,
    private readonly onUpdate: () => void,
  ) {}

  // Base bitmaps are keyed by `PdfPage.renderKey` (source page + rotation), not
  // by page number, so rearranging the document with `PdfDocument.setPages`
  // keeps every rendered page — only pages whose rotation actually changed are
  // re-rendered. Patches are transient and visible-region-only, so they stay
  // keyed by page number and are dropped on rearrangement.
  private readonly base = new Map<string, BaseBitmap>();
  private readonly baseRendering = new Map<string, InFlight>(); // renderKey -> render in progress
  private readonly patches = new Map<number, Patch>();
  private readonly patchRendering = new Map<number, PdfPageRenderCancellationToken>();
  private patchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Page the debounced patch timer is for, so it can be dropped when it scrolls away. */
  private pendingPatchPage: number | null = null;
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

  /** @internal Cap the scale so the whole page stays within the pixel budget. */
  baseScaleCap(pageNumber: number): number {
    const page = this.doc.pages[pageNumber - 1]!;
    return Math.sqrt(BASE_PIXEL_BUDGET / (page.width * page.height));
  }

  /** @internal Ensure the base bitmap for a page approaches the required scale. */
  requestBase(pageNumber: number, requiredScale: number): void {
    if (this.disposed) return;
    const key = this.keyOf(pageNumber);
    if (key === null) return;
    const scale = Math.min(requiredScale, this.baseScaleCap(pageNumber));
    const cached = this.base.get(key);
    if (cached && cached.scale >= scale / SCALE_TOLERANCE) return;
    const rendering = this.baseRendering.get(key);
    if (rendering && rendering.scale >= scale / SCALE_TOLERANCE) return;
    // A render for this page is already queued, but at too low a scale to be
    // worth waiting for: drop it rather than rendering the page twice.
    rendering?.token.cancel();

    const page = this.doc.pages[pageNumber - 1];
    if (!page) return;
    const token = page.createCancellationToken();
    this.baseRendering.set(key, { scale, token });
    void this.renderBase(pageNumber, key, scale, token);
  }

  /**
   * @internal
   * Cancels queued base renders whose page is not in `keys`. Called from the
   * paint loop so pages scrolled past give up their place in the queue to the
   * pages now on screen — the whole point of queueing renders client-side.
   */
  cancelBasesExcept(keys: ReadonlySet<string>): void {
    for (const [key, inFlight] of this.baseRendering) {
      if (!keys.has(key)) inFlight.token.cancel();
    }
  }

  private async renderBase(
    pageNumber: number,
    key: string,
    scale: number,
    token: PdfPageRenderCancellationToken,
  ): Promise<void> {
    try {
      const page = this.doc.pages[pageNumber - 1];
      // The page may have been moved away from this slot while we waited.
      if (!page || page.renderKey !== key) return;
      const image = await page.render({
        fullWidth: Math.ceil(page.width * scale),
        fullHeight: Math.ceil(page.height * scale),
        cancellationToken: token,
      });
      if (!image || this.disposed) return; // null when cancelled
      const bitmap = await image.toImageBitmap();
      if (this.disposed) {
        bitmap.close();
        return;
      }
      this.base.get(key)?.bitmap.close();
      this.base.set(key, { scale, bitmap });
      this.onUpdate();
    } catch (e) {
      console.error(`Failed to render page ${pageNumber}:`, e);
    } finally {
      // Only clear the slot if it is still ours; a newer, higher-scale render
      // may have replaced it while this one was cancelled.
      if (this.baseRendering.get(key)?.token === token) this.baseRendering.delete(key);
    }
  }

  /**
   * @internal
   * Schedule (debounced) a sharp patch render for the visible part of a page.
   * `visibleDocRect` is the intersection of the visible rect and the page rect,
   * in document coordinates; `pageRect` is the page's layout rect; `scale` is
   * the true on-screen pixel density (zoom * devicePixelRatio).
   */
  schedulePatch(pageNumber: number, visibleDocRect: Rect, pageRect: Rect, scale: number): void {
    if (this.disposed) return;
    const existing = this.patches.get(pageNumber);
    if (
      existing &&
      existing.scale === scale &&
      existing.rect.left <= visibleDocRect.left &&
      existing.rect.top <= visibleDocRect.top &&
      existing.rect.right >= visibleDocRect.right &&
      existing.rect.bottom >= visibleDocRect.bottom
    ) {
      return; // current patch still covers the view at this scale
    }
    if (this.patchTimer) clearTimeout(this.patchTimer);
    this.pendingPatchPage = pageNumber;
    this.patchTimer = setTimeout(() => {
      this.patchTimer = null;
      this.pendingPatchPage = null;
      void this.renderPatch(pageNumber, visibleDocRect, pageRect, scale);
    }, 150);
  }

  /** @internal Drop and close patches for pages no longer visible. */
  clearPatchesExcept(pageNumbers: ReadonlySet<number>): void {
    for (const [pageNumber, patch] of this.patches) {
      if (!pageNumbers.has(pageNumber)) {
        patch.bitmap.close();
        this.patches.delete(pageNumber);
      }
    }
    for (const [pageNumber, token] of this.patchRendering) {
      if (!pageNumbers.has(pageNumber)) token.cancel();
    }
    // A patch scheduled for a page that has since scrolled away is pointless.
    if (this.patchTimer && this.pendingPatchPage !== null && !pageNumbers.has(this.pendingPatchPage)) {
      clearTimeout(this.patchTimer);
      this.patchTimer = null;
      this.pendingPatchPage = null;
    }
  }

  private async renderPatch(pageNumber: number, visibleDocRect: Rect, pageRect: Rect, scale: number): Promise<void> {
    if (this.disposed) return;
    // A patch for this page is already queued for a view the user has since
    // moved on from; drop it and render what is on screen now.
    this.patchRendering.get(pageNumber)?.cancel();

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
    if (rectWidth(rect) < 1 || rectHeight(rect) < 1) return;

    const page = this.doc.pages[pageNumber - 1];
    if (!page) return;
    const token = page.createCancellationToken();
    this.patchRendering.set(pageNumber, token);
    try {
      const pageScaleX = rectWidth(pageRect) / page.width;
      const fullWidth = Math.ceil(page.width * pageScaleX * scale);
      const fullHeight = Math.ceil(page.height * pageScaleX * scale);
      const x = Math.floor((rect.left - pageRect.left) * scale);
      const y = Math.floor((rect.top - pageRect.top) * scale);
      const width = Math.ceil(rectWidth(rect) * scale);
      const height = Math.ceil(rectHeight(rect) * scale);
      const image = await page.render({ x, y, width, height, fullWidth, fullHeight, cancellationToken: token });
      if (!image || this.disposed) return; // null when cancelled
      const bitmap = await image.toImageBitmap();
      if (this.disposed) {
        bitmap.close();
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
    } catch (e) {
      console.error(`Failed to render patch for page ${pageNumber}:`, e);
    } finally {
      if (this.patchRendering.get(pageNumber) === token) this.patchRendering.delete(pageNumber);
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
      if (!live.has(key)) inFlight.token.cancel();
    }
  }

  /** @internal Drops all rendered bitmaps (e.g. after font registration changed glyphs). */
  clearAllRendered(): void {
    for (const { bitmap } of this.base.values()) bitmap.close();
    for (const { bitmap } of this.patches.values()) bitmap.close();
    this.base.clear();
    this.patches.clear();
    // In-flight renders were made with the old glyphs — drop them too.
    for (const { token } of this.baseRendering.values()) token.cancel();
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
    for (const { token } of this.baseRendering.values()) token.cancel();
    this.cancelPatchRenders();
  }

  private cancelPatchRenders(): void {
    for (const token of this.patchRendering.values()) token.cancel();
    this.patchRendering.clear();
    if (this.patchTimer) clearTimeout(this.patchTimer);
    this.patchTimer = null;
    this.pendingPatchPage = null;
  }

  /** @internal Closes every cached bitmap and stops accepting new renders. */
  dispose(): void {
    this.disposed = true;
    for (const { token } of this.baseRendering.values()) token.cancel();
    this.baseRendering.clear();
    this.cancelPatchRenders();
    for (const { bitmap } of this.base.values()) bitmap.close();
    for (const { bitmap } of this.patches.values()) bitmap.close();
    this.base.clear();
    this.patches.clear();
  }
}
