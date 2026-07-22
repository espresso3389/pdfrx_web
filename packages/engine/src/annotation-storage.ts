import type { PdfAnnotationSnapshot } from './types.js';

const BYTES_TAG = 'pdfrx:bytes';

/** Serializes an annotation snapshot to JSON, including FreeText fallback image bytes. */
export function serializeAnnotationSnapshot(snapshot: PdfAnnotationSnapshot): string {
  return JSON.stringify(snapshot, (_key, value: unknown) =>
    value instanceof Uint8Array ? { [BYTES_TAG]: bytesToBase64(value) } : value,
  );
}

/** Parses JSON produced by {@link serializeAnnotationSnapshot}. */
export function deserializeAnnotationSnapshot(json: string): PdfAnnotationSnapshot {
  const value = JSON.parse(json, (_key, item: unknown) => {
    if (isBytesEnvelope(item)) return base64ToBytes(item[BYTES_TAG]);
    return item;
  }) as Partial<PdfAnnotationSnapshot>;
  if (value.version !== 1 || !Array.isArray(value.annotations)) {
    throw new Error('Invalid annotation snapshot');
  }
  return value as PdfAnnotationSnapshot;
}

function isBytesEnvelope(value: unknown): value is Record<typeof BYTES_TAG, string> {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[BYTES_TAG] === 'string';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
