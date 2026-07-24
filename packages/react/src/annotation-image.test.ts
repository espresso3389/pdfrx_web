import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCenteredImageAnnotation, centeredImageRect } from './annotation-image.js';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('centeredImageRect', () => {
  it('centers an image at its natural size', () => {
    expect(centeredImageRect({ width: 600, height: 800 }, 200, 100)).toEqual({
      left: 200,
      bottom: 350,
      right: 400,
      top: 450,
    });
  });

  it('scales an oversized image proportionally to fit the page', () => {
    expect(centeredImageRect({ width: 600, height: 800 }, 1200, 1200)).toEqual({
      left: 180,
      bottom: 280,
      right: 420,
      top: 520,
    });
  });

  it('still fits the image when the page is smaller than the toolbar size', () => {
    expect(centeredImageRect({ width: 120, height: 200 }, 300, 150)).toEqual({
      left: 0,
      bottom: 70,
      right: 120,
      top: 130,
    });
  });
});

describe('addCenteredImageAnnotation', () => {
  it('uses a custom decoder returning RGBA pixels before trying the browser', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const addAnnotation = vi.fn().mockResolvedValue('stamp-id');
    const page = { width: 600, height: 800, addAnnotation };
    const viewer = {
      currentPageNumber: 1,
      document: { pages: [page] },
    };
    const decoder = vi.fn().mockResolvedValue({
      width: 2,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });

    await addCenteredImageAnnotation(
      viewer as never,
      new File([new Uint8Array([0, 1])], 'photo.heic'),
      1,
      decoder,
    );

    expect(decoder).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/heic');
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(addAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      subtype: 'stamp',
      appearanceImage: {
        width: 2,
        height: 1,
        pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      },
    }));
  });

  it('rejects instead of hanging when the browser decoder never settles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(() => {})));
    const viewer = {
      currentPageNumber: 1,
      document: { pages: [{ width: 600, height: 800, addAnnotation: vi.fn() }] },
    };

    const adding = addCenteredImageAnnotation(
      viewer as never,
      new File([new Uint8Array([0, 1])], 'photo.heic', { type: 'image/heic' }),
      1,
    );
    const expectation = expect(adding).rejects.toThrow('could not be decoded within 5 seconds');
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
  });
});
