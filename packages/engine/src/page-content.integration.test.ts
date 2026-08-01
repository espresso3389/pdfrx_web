import { describe, expect, it } from 'vitest';
import { PdfrxEngine, type PdfDocument } from './document.js';

describe('page-content worker commands', () => {
  it('creates, arranges, encodes, and reopens authored pages', async () => {
    const engine = new PdfrxEngine();
    let document: PdfDocument | undefined;
    let reopened: PdfDocument | undefined;
    try {
      document = await engine.createNew({ sourceName: 'page-contents-test' });
      const authored = await document.createPagesFromContents([{
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

      const blank = await document.createPagesFromContents([{ width: 50, height: 60, objects: [] }]);
      expect(document.pages).toHaveLength(0);
      document.setPages([...blank, ...authored]);
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

  it('does not encode generated pages omitted from the arrangement', async () => {
    const engine = new PdfrxEngine();
    let document: PdfDocument | undefined;
    let reopened: PdfDocument | undefined;
    try {
      document = await engine.createNew();
      const pages = await document.createPagesFromContents([
        { width: 100, height: 100, objects: [] },
        { width: 200, height: 200, objects: [] },
      ]);
      document.setPages([pages[1]!]);

      const encoded = await document.encodePdf();
      reopened = await engine.openData(encoded, { transferData: false });
      expect(reopened.pages.map((page) => [page.width, page.height])).toEqual([[200, 200]]);
    } finally {
      if (reopened) await reopened.dispose();
      if (document) await document.dispose();
      engine.dispose();
    }
  }, 20_000);

  it('keeps a new document empty until generated pages are arranged', async () => {
    const engine = new PdfrxEngine();
    let document: PdfDocument | undefined;
    let reopened: PdfDocument | undefined;
    try {
      document = await engine.createNew();
      await document.createPagesFromContents([{ width: 100, height: 100, objects: [] }]);

      const encoded = await document.encodePdf();
      reopened = await engine.openData(encoded, { transferData: false });
      expect(reopened.pages).toHaveLength(0);
    } finally {
      if (reopened) await reopened.dispose();
      if (document) await document.dispose();
      engine.dispose();
    }
  }, 20_000);
});
