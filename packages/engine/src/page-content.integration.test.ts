import { describe, expect, it } from 'vitest';
import { PdfrxEngine, type PdfDocument } from './document.js';

describe('page-content worker commands', () => {
  it('creates, inserts, encodes, and reopens authored pages', async () => {
    const engine = new PdfrxEngine();
    let document: PdfDocument | undefined;
    let reopened: PdfDocument | undefined;
    try {
      document = await engine.createFromPageContents([{
        width: 200,
        height: 200,
        objects: [
          {
            kind: 'path',
            segments: [
              { op: 'moveTo', x: 10, y: 10 },
              { op: 'lineTo', x: 190, y: 10 },
              { op: 'lineTo', x: 100, y: 180 },
              { op: 'close' },
            ],
            fill: { r: 20, g: 100, b: 220, a: 255 },
          },
          {
            kind: 'text',
            runs: [{ text: 'Page content', fontFace: null, x: 20, y: 80, fontSize: 18 }],
          },
          {
            kind: 'image',
            source: {
              kind: 'pixels',
              pixels: new Uint8Array([255, 0, 0, 255]).buffer,
              pixelWidth: 1,
              pixelHeight: 1,
              format: 'rgba8888',
            },
            transform: [20, 0, 0, 20, 160, 160],
          },
        ],
      }]);

      await engine.insertPageContents(document, 0, [{ width: 50, height: 60, objects: [] }]);
      expect(document.pages.map((page) => [page.width, page.height])).toEqual([[50, 60], [200, 200]]);

      const encoded = await document.encodePdf();
      expect(encoded.byteLength).toBeGreaterThan(500);
      reopened = await engine.openData(encoded, { transferData: false });
      expect(reopened.pages).toHaveLength(2);
      expect(await reopened.pages[1]?.loadText()).toMatchObject({ fullText: expect.stringContaining('Page content') });
    } finally {
      if (reopened) await reopened.dispose();
      if (document) await document.dispose();
      engine.dispose();
    }
  }, 20_000);
});
