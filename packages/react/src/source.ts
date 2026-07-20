import type { PdfOpenOptions, PdfOpenUrlOptions } from '@pdfrx/engine';

/**
 * A document to open, in whatever shape is most convenient.
 *
 * The shorthands (`string`, `URL`, `File`, `Blob`, `Uint8Array`, `ArrayBuffer`)
 * cover the common cases; the object forms exist when you need to pass
 * `passwordProvider`, HTTP headers, or a `sourceName` alongside the data.
 *
 * `null`/`undefined` means "no document" — the viewer is created but stays
 * empty, and you can open something later with {@link usePdfrxViewer}.
 *
 * @example
 * ```tsx
 * <PdfrxProvider src="/manual.pdf" />
 * <PdfrxProvider src={{ url: '/secret.pdf', passwordProvider: () => prompt('password') }} />
 * <PdfrxProvider src={{ data: bytes, sourceName: 'upload.pdf' }} />
 * ```
 */
export type PdfSource =
  | string
  | URL
  | File
  | Blob
  | Uint8Array
  | ArrayBuffer
  | ({ url: string | URL } & PdfOpenUrlOptions)
  | ({ data: Uint8Array | ArrayBuffer | File | Blob } & PdfOpenOptions)
  | null
  | undefined;

/** A {@link PdfSource} reduced to the two shapes the viewer actually accepts. */
export type NormalizedPdfSource =
  | { kind: 'url'; url: string | URL; options: PdfOpenUrlOptions }
  | { kind: 'data'; data: Uint8Array | ArrayBuffer | File | Blob; options: PdfOpenOptions };

/** Narrows a {@link PdfSource} to {@link NormalizedPdfSource}, or `null` for no document. */
export function normalizeSource(src: PdfSource): NormalizedPdfSource | null {
  if (src == null) return null;
  if (typeof src === 'string' || src instanceof URL) return { kind: 'url', url: src, options: {} };
  if (typeof File !== 'undefined' && src instanceof File) {
    return { kind: 'data', data: src, options: { sourceName: src.name } };
  }
  if (src instanceof Blob || src instanceof Uint8Array || src instanceof ArrayBuffer) {
    return { kind: 'data', data: src, options: {} };
  }
  if ('url' in src) {
    const { url, ...options } = src;
    return { kind: 'url', url, options };
  }
  const { data, ...options } = src;
  if (typeof File !== 'undefined' && data instanceof File && options.sourceName === undefined) {
    return { kind: 'data', data, options: { ...options, sourceName: data.name } };
  }
  return { kind: 'data', data, options };
}

/**
 * A cheap identity for a source, so a re-render with an equivalent `src` prop
 * does not reopen the document. Byte arrays and blobs fall back to reference
 * identity (hashing them would be worse than reopening).
 */
export function sourceKey(src: NormalizedPdfSource | null): unknown {
  if (!src) return null;
  if (src.kind === 'url') return `url:${String(src.url)}`;
  return src.data;
}

/** Reads a `File`/`Blob` into the bytes the engine wants; passes arrays through. */
export async function toBytes(data: Uint8Array | ArrayBuffer | File | Blob): Promise<Uint8Array | ArrayBuffer> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return data;
}
