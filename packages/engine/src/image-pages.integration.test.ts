import { describe, expect, it } from 'vitest';
import { PdfrxEngine, type PdfDocument } from './document.js';

describe('image-page worker command', () => {
  it('creates unplaced image pages and encodes only their final arrangement', async () => {
    const engine = new PdfrxEngine();
    let document: PdfDocument | undefined;
    let reopened: PdfDocument | undefined;
    try {
      document = await engine.createNew();
      const pages = await document.createPagesFromImages([
        { pixels: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 },
        { pixels: new Uint8Array([0, 0, 255, 255]), width: 1, height: 1 },
      ], { pageSize: { width: 120, height: 80 } });

      expect(document.pages).toHaveLength(0);
      expect(pages.map((page) => [page.width, page.height])).toEqual([
        [120, 80],
        [120, 80],
      ]);

      document.setPages([pages[1]!]);
      const encoded = await document.encodePdf();
      reopened = await engine.openData(encoded, { transferData: false });
      expect(reopened.pages.map((page) => [page.width, page.height])).toEqual([[120, 80]]);
    } finally {
      if (reopened) await reopened.dispose();
      if (document) await document.dispose();
      engine.dispose();
    }
  }, 20_000);
});
