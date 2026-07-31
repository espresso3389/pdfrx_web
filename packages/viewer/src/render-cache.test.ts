import type { PdfDocument } from '@pdfrx/engine';
import { describe, expect, it } from 'vitest';
import { PageRenderCache } from './render-cache.js';

const visibleRect = { left: 10, top: 20, right: 90, bottom: 80 };

const createCache = (): PageRenderCache => new PageRenderCache({
  pages: [{ width: 100, height: 100, renderKey: 'page-1' }],
} as unknown as PdfDocument, () => {});

const setBase = (cache: PageRenderCache, scale: number): void => {
  const internals = cache as unknown as {
    base: Map<string, { scale: number; bitmap: ImageBitmap }>;
  };
  internals.base.set('page-1', { scale, bitmap: {} as ImageBitmap });
};

const setPatch = (cache: PageRenderCache, scale: number, rect = visibleRect): void => {
  const internals = cache as unknown as {
    patches: Map<number, { scale: number; rect: typeof visibleRect; bitmap: ImageBitmap }>;
  };
  internals.patches.set(1, { scale, rect, bitmap: {} as ImageBitmap });
};

describe('PageRenderCache.isReady', () => {
  it('waits for a base bitmap at the cache quality threshold', () => {
    const cache = createCache();
    expect(cache.isReady(1, visibleRect, 2)).toBe(false);
    setBase(cache, 2 / 1.4);
    expect(cache.isReady(1, visibleRect, 2)).toBe(true);
  });

  it('requires an exact-scale patch covering the visible area above the base cap', () => {
    const cache = createCache();
    const requiredScale = 30;
    setBase(cache, cache.baseScaleCap(1));

    expect(cache.isReady(1, visibleRect, requiredScale)).toBe(false);
    setPatch(cache, requiredScale - 1);
    expect(cache.isReady(1, visibleRect, requiredScale)).toBe(false);
    setPatch(cache, requiredScale, { ...visibleRect, right: visibleRect.right - 1 });
    expect(cache.isReady(1, visibleRect, requiredScale)).toBe(false);
    setPatch(cache, requiredScale);
    expect(cache.isReady(1, visibleRect, requiredScale)).toBe(true);
  });
});
