import { describe, expect, it } from 'vitest';
import type { PdfFontQuery } from '@pdfrx/engine';
import { googleFontsResolver } from './font-fallback.js';

const resolve = (face: string, charset: number, pitchFamily = 0) =>
  googleFontsResolver({ face, charset, pitchFamily, weight: 400, isItalic: false } satisfies PdfFontQuery);

describe('googleFontsResolver family selection', () => {
  it('selects CJK serif and sans substitutes from normalized family names', () => {
    expect(resolve('STSong-Light-UniGB-UCS2-H', 134, 0x20)?.resolvedFace).toBe('Noto Serif SC');
    expect(resolve('Microsoft YaHei', 134, 0x10)?.resolvedFace).toBe('Noto Sans SC');
    expect(resolve('MS-Mincho', 128, 0x20)?.resolvedFace).toBe('Noto Serif JP');
    expect(resolve('YuGothic', 128, 0x10)?.resolvedFace).toBe('Noto Sans JP');
    expect(resolve('Batang', 129, 0x20)?.resolvedFace).toBe('Noto Serif KR');
    expect(resolve('Malgun Gothic', 129, 0x10)?.resolvedFace).toBe('Noto Sans KR');
  });

  it('does not misclassify Modern as Roman', () => {
    expect(resolve('Unknown Modern Face', 134, 0x30)?.resolvedFace).toBe('Noto Sans SC');
  });
});
