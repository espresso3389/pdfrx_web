import { describe, expect, it } from 'vitest';
import { dragMayContainImage, isImageFile } from './file-open.js';

describe('isImageFile', () => {
  it('recognizes typeless HEIC and HEIF files for custom decoders', () => {
    expect(isImageFile(new File([], 'photo.heic'))).toBe(true);
    expect(isImageFile(new File([], 'photo.HEIF'))).toBe(true);
  });
});

describe('dragMayContainImage', () => {
  it('admits a file item with no MIME type so HEIC can be classified on drop', () => {
    expect(dragMayContainImage([{ kind: 'file', type: '' }], [])).toBe(true);
  });

  it('does not claim a non-image drag with a known MIME type', () => {
    expect(dragMayContainImage([{ kind: 'file', type: 'application/pdf' }], [])).toBe(false);
  });
});
