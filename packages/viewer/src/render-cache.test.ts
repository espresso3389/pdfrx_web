import type { PdfDocument } from '@pdfrx/engine';
import { describe, expect, it, vi } from 'vitest';
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

describe('PageRenderCache render requests', () => {
  it('reports completion from the concrete base render promise', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const page = {
      width: 100,
      height: 100,
      renderKey: 'page-1',
      createCancellationToken: () => ({ cancel: vi.fn() }),
      render: vi.fn(async () => ({ toImageBitmap: async () => bitmap })),
    };
    const cache = new PageRenderCache({ pages: [page] } as unknown as PdfDocument, () => {});

    await expect(cache.requestBase(1, 2)).resolves.toEqual({ status: 'completed' });
  });

  it('reports a render failure without creating an unhandled rejected promise', async () => {
    const failure = new Error('render failed');
    const page = {
      width: 100,
      height: 100,
      renderKey: 'page-1',
      createCancellationToken: () => ({ cancel: vi.fn() }),
      render: vi.fn(async () => { throw failure; }),
    };
    const cache = new PageRenderCache({ pages: [page] } as unknown as PdfDocument, () => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(cache.requestBase(1, 2)).resolves.toEqual({ status: 'failed', error: failure });
    consoleError.mockRestore();
  });

  it('settles a cancelled debounce instead of leaving its promise pending', async () => {
    vi.useFakeTimers();
    const cache = createCache();
    const request = cache.schedulePatch(
      1,
      visibleRect,
      { left: 0, top: 0, right: 100, bottom: 100 },
      30,
    );

    cache.cancelAllPending();

    await expect(request).resolves.toEqual({ status: 'cancelled', reason: 'debounce-cancelled' });
    vi.useRealTimers();
  });

  it('settles an in-flight render immediately when its cancellation wrapper is cancelled', async () => {
    const page = {
      width: 100,
      height: 100,
      renderKey: 'page-1',
      createCancellationToken: () => ({ cancel: vi.fn() }),
      render: vi.fn(() => new Promise(() => {})),
    };
    const cache = new PageRenderCache({ pages: [page] } as unknown as PdfDocument, () => {});
    const request = cache.requestBase(1, 2);

    cache.cancelAllPending();

    await expect(request).resolves.toEqual({ status: 'cancelled', reason: 'pending-cancelled' });
  });

  it('keeps independent high-resolution region requests for visible pages', () => {
    vi.useFakeTimers();
    const cache = new PageRenderCache({
      pages: [
        { width: 100, height: 100, renderKey: 'page-1' },
        { width: 100, height: 100, renderKey: 'page-2' },
      ],
    } as unknown as PdfDocument, () => {});

    cache.schedulePatch(1, visibleRect, { left: 0, top: 0, right: 100, bottom: 100 }, 30);
    cache.schedulePatch(2, visibleRect, { left: 0, top: 100, right: 100, bottom: 200 }, 30);

    const internals = cache as unknown as { pendingPatches: Map<number, unknown> };
    expect([...internals.pendingPatches.keys()]).toEqual([1, 2]);
    cache.cancelAllPending();
    vi.useRealTimers();
  });

  it('returns the same owned promise for an identical pending patch request', async () => {
    vi.useFakeTimers();
    const cache = createCache();
    const pageRect = { left: 0, top: 0, right: 100, bottom: 100 };

    const first = cache.schedulePatch(1, visibleRect, pageRect, 30);
    const second = cache.schedulePatch(1, visibleRect, pageRect, 30);

    expect(second).toBe(first);
    cache.cancelAllPending();
    await expect(first).resolves.toMatchObject({ status: 'cancelled' });
    vi.useRealTimers();
  });

  it('rounds both patch endpoints outwards so fractional visible bounds become ready', async () => {
    vi.useFakeTimers();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const page = {
      width: 100,
      height: 100,
      renderKey: 'page-1',
      createCancellationToken: () => ({ cancel: vi.fn() }),
      render: vi.fn(async () => ({ toImageBitmap: async () => bitmap })),
    };
    const cache = new PageRenderCache({ pages: [page] } as unknown as PdfDocument, () => {});
    const pageRect = { left: 0, top: 0, right: 100, bottom: 100 };
    const fractionalVisibleRect = { left: 0.03, top: 0.02, right: 80.01, bottom: 60.01 };
    const scale = 30;
    setBase(cache, cache.baseScaleCap(1));

    const request = cache.schedulePatch(1, fractionalVisibleRect, pageRect, scale);
    await vi.runAllTimersAsync();
    await expect(request).resolves.toEqual({ status: 'completed' });

    expect(page.render).toHaveBeenCalledWith(expect.objectContaining({
      x: 0,
      y: 0,
      width: 2401,
      height: 1801,
    }));
    expect(cache.isReady(1, fractionalVisibleRect, scale)).toBe(true);
    vi.useRealTimers();
  });
});
