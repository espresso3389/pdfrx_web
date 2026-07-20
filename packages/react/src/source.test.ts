import { describe, expect, it } from 'vitest';
import { normalizeSource, sourceKey } from './source.js';

describe('normalizeSource', () => {
  it('treats a string and a URL as the same url source', () => {
    expect(normalizeSource('doc.pdf')).toEqual({ kind: 'url', url: 'doc.pdf', options: {} });
    const url = new URL('https://example.com/doc.pdf');
    expect(normalizeSource(url)).toEqual({ kind: 'url', url, options: {} });
  });

  it('splits the object form into url and open options', () => {
    const passwordProvider = (): string => 'secret';
    expect(normalizeSource({ url: 'doc.pdf', passwordProvider, withCredentials: true })).toEqual({
      kind: 'url',
      url: 'doc.pdf',
      options: { passwordProvider, withCredentials: true },
    });
  });

  it('names a File source after the file, without clobbering an explicit name', () => {
    const file = new File([new Uint8Array([1])], 'upload.pdf', { type: 'application/pdf' });
    expect(normalizeSource(file)).toEqual({ kind: 'data', data: file, options: { sourceName: 'upload.pdf' } });
    expect(normalizeSource({ data: file, sourceName: 'renamed.pdf' })).toEqual({
      kind: 'data',
      data: file,
      options: { sourceName: 'renamed.pdf' },
    });
  });

  it('maps no document to null', () => {
    expect(normalizeSource(null)).toBeNull();
    expect(normalizeSource(undefined)).toBeNull();
  });
});

describe('sourceKey', () => {
  it('matches equivalent URLs so a re-render does not reopen the document', () => {
    expect(sourceKey(normalizeSource('doc.pdf'))).toBe(sourceKey(normalizeSource('doc.pdf')));
    expect(sourceKey(normalizeSource('doc.pdf'))).toBe(sourceKey(normalizeSource({ url: 'doc.pdf' })));
    expect(sourceKey(normalizeSource('a.pdf'))).not.toBe(sourceKey(normalizeSource('b.pdf')));
  });

  it('falls back to reference identity for bytes', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(sourceKey(normalizeSource(bytes))).toBe(bytes);
    // Equal-but-distinct arrays are treated as different documents: hashing
    // megabytes on every render would cost more than the reopen it saves.
    expect(sourceKey(normalizeSource(new Uint8Array([1, 2, 3])))).not.toBe(bytes);
  });
});
