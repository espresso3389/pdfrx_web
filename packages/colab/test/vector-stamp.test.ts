import { PdfrxEngine, type PdfDocument, type PdfImageSource } from '@pdfrx/engine';
import { afterAll, describe, expect, it } from 'vitest';

const engine = new PdfrxEngine();
afterAll(() => engine.dispose());

async function createImageDocument(images: PdfImageSource[]): Promise<PdfDocument> {
  const document = await engine.createNew();
  const pages = await document.createPagesFromImages(images);
  document.setPages(pages);
  return document;
}

describe('vector stamp appearance round-trip', () => {
  it('keeps a raster stamp visible after an in-place move', async () => {
    const background = { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) };
    const stampPixels = new Uint8Array(8 * 8 * 4);
    for (let offset = 0; offset < stampPixels.length; offset += 4) {
      stampPixels.set([255, 0, 0, 255], offset);
    }
    const document = await createImageDocument([background]);
    try {
      const page = document.pages[0]!;
      const id = await page.addAnnotation({
        subtype: 'stamp',
        rect: { left: 0, bottom: 0, right: 0.4, top: 0.4 },
        appearanceImage: { width: 8, height: 8, pixels: stampPixels },
      });
      const before = await page.render({ fullWidth: 100, fullHeight: 100 });
      expect(before?.pixels.slice((80 * 100 + 20) * 4, (80 * 100 + 20) * 4 + 4))
        .toEqual(new Uint8Array([255, 0, 0, 255]));

      await page.updateAnnotation(id, {
        subtype: 'stamp',
        rect: { left: 0.5, bottom: 0, right: 0.9, top: 0.4 },
        appearanceImage: { width: 8, height: 8, pixels: stampPixels },
      }, { preserveAppearance: true });

      const after = await page.render({ fullWidth: 100, fullHeight: 100 });
      expect(after?.pixels.slice((80 * 100 + 70) * 4, (80 * 100 + 70) * 4 + 4))
        .toEqual(new Uint8Array([255, 0, 0, 255]));
    } finally {
      await document.dispose();
    }
  });

  it('does not enable PDFium default fill colors on stroke-only paths', async () => {
    const background = { width: 32, height: 32, pixels: new Uint8Array(32 * 32 * 4).fill(255) };
    const document = await createImageDocument([background]);
    try {
      const id = await document.pages[0]!.addAnnotation({
        subtype: 'stamp',
        rect: { left: 2, bottom: 2, right: 30, top: 30 },
        appearancePaths: [{
          segments: [
            { type: 'move', point: { x: 0, y: 0 }, close: false },
            { type: 'line', point: { x: 1, y: 1 }, close: false },
          ],
          // PDFium reports this default black even though fillMode is disabled.
          fillColor: { r: 0, g: 0, b: 0, a: 255 },
          strokeColor: { r: 255, g: 255, b: 255, a: 255 },
          strokeWidth: 0.05,
          fillMode: 0,
          stroke: true,
          lineCap: 0,
          lineJoin: 0,
        }],
      });
      const loaded = await document.pages[0]!.loadAnnotations();
      expect(loaded[0]?.appearancePaths[0]?.fillMode).toBe(0);

      await document.pages[0]!.updateAnnotation(id, {
        subtype: 'stamp',
        rect: { left: 4, bottom: 4, right: 28, top: 28 },
        appearancePaths: [{
          segments: [
            { type: 'move', point: { x: 0, y: 0 }, close: false },
            { type: 'line', point: { x: 1, y: 1 }, close: false },
          ],
          fillColor: { r: 0, g: 0, b: 0, a: 255 },
          strokeColor: { r: 255, g: 255, b: 255, a: 255 },
          strokeWidth: 0.05,
          fillMode: 0,
          stroke: true,
          lineCap: 0,
          lineJoin: 0,
        }],
      });
      const moved = await document.pages[0]!.loadAnnotations();
      expect(moved[0]?.appearancePaths[0]?.fillMode).toBe(0);
      expect(moved[0]?.appearancePaths[0]?.stroke).toBe(true);
    } finally {
      await document.dispose();
    }
  });

  it('preserves raster appearances in place and compacts stale replacements', async () => {
    const background = { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) };
    const pixels = Uint8Array.from({ length: 64 * 64 * 4 }, (_, index) => (index * 73 + 19) & 0xff);
    const appearanceImage = { width: 64, height: 64, pixels };
    const makeSpec = (left: number) => ({
      subtype: 'stamp' as const,
      rect: { left, bottom: 0, right: left + 0.8, top: 0.8 },
      appearanceImage,
    });

    const preserved = await createImageDocument([background]);
    try {
      const page = preserved.pages[0]!;
      const id = await page.addAnnotation(makeSpec(0));
      for (let index = 0; index < 20; index++) {
        await page.updateAnnotation(id, makeSpec((index % 2) * 0.01), { preserveAppearance: true });
      }
      const bytes = await preserved.encodePdf();
      expect(bytes.byteLength).toBeLessThan(100_000);
      const [annotation] = await page.loadAnnotations();
      expect(annotation?.rect.left).toBeCloseTo(0.01);
      expect(annotation?.appearanceImage?.pixels.byteLength).toBe(pixels.byteLength);
    } finally {
      await preserved.dispose();
    }

    const replaced = await createImageDocument([background]);
    try {
      const page = replaced.pages[0]!;
      const id = await page.addAnnotation(makeSpec(0));
      for (let index = 0; index < 20; index++) {
        await page.updateAnnotation(id, makeSpec((index % 2) * 0.01));
      }
      const ordinary = await replaced.encodePdf();
      const compact = await replaced.encodePdf({ mode: 'compact' });
      expect(compact.byteLength).toBeLessThan(ordinary.byteLength / 3);
    } finally {
      await replaced.dispose();
    }
  });
});
