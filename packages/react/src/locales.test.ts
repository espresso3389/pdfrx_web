import { describe, expect, it } from 'vitest';
import { defaultPdfrxStrings } from './strings.js';
import { builtinPdfrxLocales, builtinPdfrxStrings, resolvePdfrxStrings } from './locales.js';

describe('resolvePdfrxStrings', () => {
  it('matches a plain language tag', () => {
    expect(resolvePdfrxStrings('ja').search).toBe('検索');
    expect(resolvePdfrxStrings('fr').search).toBe('Rechercher');
    expect(resolvePdfrxStrings('de').search).toBe('Suchen');
    expect(resolvePdfrxStrings('en').search).toBe('Search');
  });

  it('is case-insensitive and ignores a region subtag', () => {
    expect(resolvePdfrxStrings('FR').search).toBe('Rechercher');
    expect(resolvePdfrxStrings('fr-CA').search).toBe('Rechercher');
    expect(resolvePdfrxStrings('de-AT').search).toBe('Suchen');
  });

  it('splits Chinese by script/region', () => {
    expect(resolvePdfrxStrings('zh-Hans').pagesTab).toBe('页面');
    expect(resolvePdfrxStrings('zh-CN').pagesTab).toBe('页面');
    expect(resolvePdfrxStrings('zh-SG').pagesTab).toBe('页面');
    expect(resolvePdfrxStrings('zh-Hant').pagesTab).toBe('頁面');
    expect(resolvePdfrxStrings('zh-TW').pagesTab).toBe('頁面');
    expect(resolvePdfrxStrings('zh-HK').pagesTab).toBe('頁面');
    // Bare `zh` defaults to Simplified.
    expect(resolvePdfrxStrings('zh').pagesTab).toBe('页面');
  });

  it('falls back to English for an unsupported locale', () => {
    expect(resolvePdfrxStrings('es')).toBe(builtinPdfrxStrings.en);
    expect(resolvePdfrxStrings('es').search).toBe('Search');
    expect(resolvePdfrxStrings([])).toBe(builtinPdfrxStrings.en);
  });

  it('takes the first supported tag from a priority list', () => {
    expect(resolvePdfrxStrings(['es', 'de', 'en']).search).toBe('Suchen');
    expect(resolvePdfrxStrings(['pt', 'it']).search).toBe('Search');
  });

  it('resolves interpolating strings per locale', () => {
    expect(resolvePdfrxStrings('ja').goToPage(3)).toBe('3 ページへ移動');
    expect(resolvePdfrxStrings('fr').failedToOpen('x')).toBe("Échec de l'ouverture du document : x");
  });

  it('localizes editing and annotation controls', () => {
    const ja = resolvePdfrxStrings('ja');
    expect(ja.undo).toBe('元に戻す');
    expect(ja.redo).toBe('やり直す');
    expect(ja.textSelection).toBe('テキストを選択');
    expect(ja.strokeColor).toBe('線の色');
    expect(ja.closeAnnotationToolbar).toBe('注釈ツールバーを閉じる');
  });
});

describe('builtinPdfrxStrings', () => {
  it('has an entry for every advertised locale', () => {
    for (const locale of builtinPdfrxLocales) {
      expect(builtinPdfrxStrings[locale]).toBeDefined();
    }
  });

  it('is complete — every translation defines every key (English fallback)', () => {
    const keys = Object.keys(defaultPdfrxStrings) as (keyof typeof defaultPdfrxStrings)[];
    for (const locale of builtinPdfrxLocales) {
      const strings = builtinPdfrxStrings[locale];
      for (const key of keys) {
        expect(strings[key], `${locale}.${String(key)}`).toBeDefined();
      }
    }
  });
});
