import { describe, expect, it } from 'vitest';
import { preparePageContents, type PdfPageContentSpec } from './page-content.js';

describe('page content preparation', () => {
  it('collects binary assets once for a single worker transfer', () => {
    const pixels = new ArrayBuffer(16);
    const pages: PdfPageContentSpec[] = [{
      width: 100,
      height: 200,
      objects: [
        { kind: 'image', source: { kind: 'pixels', pixels, pixelWidth: 2, pixelHeight: 2, format: 'rgba8888' }, transform: [2, 0, 0, 2, 10, 20] },
        { kind: 'image', source: { kind: 'pixels', pixels, pixelWidth: 2, pixelHeight: 2, format: 'rgba8888' }, transform: [2, 0, 0, 2, 30, 40] },
      ],
    }];
    const prepared = preparePageContents(pages);
    expect(prepared.pages).toHaveLength(1);
    expect(prepared.transfer).toEqual([pixels]);
  });

  it('rejects unsupported JPEG opacity before transferring its buffer', () => {
    expect(() => preparePageContents([{
      width: 100,
      height: 100,
      objects: [{
        kind: 'image',
        source: { kind: 'jpeg', data: new ArrayBuffer(4) },
        transform: [1, 0, 0, 1, 0, 0],
        opacity: 0.5,
      }],
    }])).toThrow(/JPEG.*opacity 1/);
  });

  it('rejects invalid page geometry and empty paths', () => {
    expect(() => preparePageContents([{ width: 0, height: 100, objects: [] }])).toThrow(/invalid size/);
    expect(() => preparePageContents([{
      width: 100,
      height: 100,
      objects: [{ kind: 'path', segments: [] }],
    }])).toThrow(/empty path/);
  });
});
