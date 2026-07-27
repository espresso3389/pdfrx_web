import { describe, expect, it, vi } from 'vitest';
import {
  decodeRgbaPng,
  prepareFreeTextAppearance,
  type PdfAnnotationSpec,
  type PdfEmojiRenderer,
} from '@pdfrx/engine';

const rect = { left: 0, bottom: 0, right: 200, top: 40 };

describe('prepareFreeTextAppearance', () => {
  it('keeps an emoji sequence atomic and builds mixed-script runs', async () => {
    const rendered: string[] = [];
    const renderEmoji: PdfEmojiRenderer = async (grapheme, fontSize) => {
      rendered.push(grapheme);
      return {
        width: 36,
        height: 36,
        scale: 3,
        advance: fontSize,
        pixels: new Uint8Array(36 * 36 * 4),
      };
    };
    const charsets: number[] = [];
    const spec: PdfAnnotationSpec = {
      subtype: 'freeText',
      rect,
      contents: '日本語👨‍👩‍👧‍👦ABC',
    };

    await prepareFreeTextAppearance(spec, {
      language: 'ja',
      services: {
        measureText: (text, fontSize) => [...text].length * fontSize * 0.5,
        resolveFont: async (charset) => {
          charsets.push(charset);
          return `face-${charset}`;
        },
        renderEmoji,
      },
    });

    expect(rendered).toEqual(['👨‍👩‍👧‍👦']);
    expect(charsets).toContain(128);
    expect(spec.appearanceRuns?.[0]?.map((run) => run.text)).toEqual(['日本語', '👨‍👩‍👧‍👦', 'ABC']);
    expect(spec.appearanceRuns?.[0]?.[1]?.image).toBeDefined();
  });

  it('renders adjacent emoji as separate grapheme assets', async () => {
    const rendered: string[] = [];
    const spec: PdfAnnotationSpec = {
      subtype: 'freeText',
      rect,
      contents: '😀👋',
    };

    await prepareFreeTextAppearance(spec, {
      services: {
        renderEmoji: async (grapheme) => {
          rendered.push(grapheme);
          return {
            width: 1,
            height: 1,
            scale: 1,
            advance: 1,
            pixels: new Uint8Array(4),
          };
        },
      },
    });

    expect(rendered).toEqual(['😀', '👋']);
  });

  it('uses the language hint to disambiguate Han-only text', async () => {
    const resolveFont = vi.fn((charset: number) => `face-${charset}`);
    const spec: PdfAnnotationSpec = { subtype: 'freeText', rect, contents: '漢字' };

    await prepareFreeTextAppearance(spec, {
      language: 'zh-Hant-TW',
      services: { resolveFont, renderEmoji: null },
    });

    expect(resolveFont).toHaveBeenCalledWith(136);
    expect(spec.fontFace).toBe('face-136');
  });
});

describe('decodeRgbaPng', () => {
  it('decodes an 8-bit RGBA PNG without a platform image decoder', async () => {
    const bytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z9DwHwAGAAJ/IQJzOwAAAABJRU5ErkJggg=='),
      (character) => character.charCodeAt(0),
    );

    const decoded = await decodeRgbaPng(bytes);

    expect(decoded).toEqual({
      width: 1,
      height: 1,
      pixels: new Uint8Array([255, 0, 128, 255]),
    });
  });
});
