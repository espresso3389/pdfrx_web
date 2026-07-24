import { PdfrxEngine } from '@pdfrx/engine';
import { afterAll, describe, expect, it } from 'vitest';

const engine = new PdfrxEngine();
afterAll(() => engine.dispose());

describe('vector stamp appearance round-trip', () => {
  it('does not enable PDFium default fill colors on stroke-only paths', async () => {
    const background = { width: 32, height: 32, pixels: new Uint8Array(32 * 32 * 4).fill(255) };
    const document = await engine.createFromImages([background]);
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
});
