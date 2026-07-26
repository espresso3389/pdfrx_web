import { describe, expect, it } from 'vitest';
import type { PdfFontQuery } from '@pdfrx/engine';
import { classifyFontFamily, normalizeFontFamilyName } from './font-family.js';

const query = (face: string, pitchFamily = 0): PdfFontQuery => ({
  face,
  weight: 400,
  isItalic: false,
  charset: 1,
  pitchFamily,
});

describe('normalizeFontFamilyName', () => {
  it('removes PDF subset, style, and CMap suffixes', () => {
    expect(normalizeFontFamilyName('ABCDEF+STSong-Light-UniGB-UCS2-H')).toBe('stsong');
    expect(normalizeFontFamilyName('/Microsoft YaHei Bold')).toBe('microsoftyahei');
    expect(normalizeFontFamilyName('YuMincho-DemiboldItalic')).toBe('yumincho');
  });
});

describe('classifyFontFamily', () => {
  it.each([
    ['STSong-Light-UniGB-UCS2-H', 'serif'],
    ['SimSun', 'serif'],
    ['Microsoft YaHei', 'sans'],
    ['STHeitiSC-Light', 'sans'],
    ['MS-PMincho', 'serif'],
    ['Hiragino Kaku Gothic ProN', 'sans'],
    ['Malgun Gothic', 'sans'],
    ['NanumMyeongjo', 'serif'],
  ] as const)('classifies known CJK family %s as %s', (face, expected) => {
    expect(classifyFontFamily(query(face))).toBe(expected);
  });

  it('prefers a known family name over a contradictory PDFium hint', () => {
    expect(classifyFontFamily(query('Microsoft YaHei', 0x10))).toBe('sans');
    expect(classifyFontFamily(query('STSong-Light', 0x20))).toBe('serif');
  });

  it('treats the family nibble as an enum rather than independent flags', () => {
    expect(classifyFontFamily(query('Unknown', 0x10))).toBe('serif');
    expect(classifyFontFamily(query('Unknown', 0x20))).toBe('sans');
    expect(classifyFontFamily(query('Unknown', 0x30))).toBe('mono');
    expect(classifyFontFamily(query('Unknown', 0x40))).toBe('script');
  });
});
