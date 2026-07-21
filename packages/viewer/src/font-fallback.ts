/**
 * Missing-font fallback via Google Fonts.
 *
 * The rendering engine has no system fonts, so every non-embedded font
 * (including Arial/Times/Courier) surfaces as a `missingFonts` event. This
 * resolver maps each query to a downloadable substitute:
 *
 * - PDF standard / Core fonts -> metric-compatible Arimo / Tinos / Cousine
 * - everything else -> a Noto family chosen by charset and style
 *
 * All files are fetched from fonts.gstatic.com, which serves
 * `access-control-allow-origin: *`. The big Noto CJK OTC collections are
 * skipped here because GitHub raw has no CORS.
 */

import type { PdfFontQuery } from '@pdfrx/engine';
import {
  arimo,
  arimoItalic,
  cousine,
  cousineItalic,
  notoNaskhArabic,
  notoSans,
  notoSansArabic,
  notoSansHebrew,
  notoSansItalic,
  notoSansJp,
  notoSansKr,
  notoSansSc,
  notoSansTc,
  notoSansThai,
  notoSerif,
  notoSerifHebrew,
  notoSerifItalic,
  notoSerifJp,
  notoSerifKr,
  notoSerifSc,
  notoSerifTc,
  notoSerifThai,
  tinos,
  tinosItalic,
  type GoogleFontsFile,
  type WeightTable,
} from './font-tables.js';

/** Windows charset ids, as reported in {@link PdfFontQuery.charset}. */
const enum Charset {
  ansi = 0,
  default_ = 1,
  symbol = 2,
  shiftJis = 128,
  hangul = 129,
  gb2312 = 134,
  chineseBig5 = 136,
  greek = 161,
  vietnamese = 163,
  hebrew = 177,
  arabic = 178,
  cyrillic = 204,
  thai = 222,
  easternEuropean = 238,
}

const isFixed = (q: PdfFontQuery): boolean => (q.pitchFamily & 1) !== 0;
const isRoman = (q: PdfFontQuery): boolean => (q.pitchFamily & 16) !== 0;

/**
 * The outcome of resolving one missing-font query: which substitute file to
 * download and the family name it declares.
 *
 * @see [Missing-font fallback](https://github.com/espresso3389/pdfrx_web/blob/master/docs/FONT-FALLBACK.md)
 *   — the full font-mapping reference.
 */
export interface FontResolution {
  /** The font family name the engine is expected to see inside the file. */
  resolvedFace: string;
  /** URL of the substitute font file to fetch (must be CORS-accessible). */
  url: string;
  /** Expected byte length, used to reject stale or corrupted downloads. */
  expectedLength?: number;
}

/**
 * Maps a missing-font query to a downloadable substitute, or `null` to leave it
 * unresolved. Pass one as {@link PdfrxViewerOptions.fontResolver} (the default
 * is {@link googleFontsResolver}).
 *
 * @see [Missing-font fallback](https://github.com/espresso3389/pdfrx_web/blob/master/docs/FONT-FALLBACK.md)
 *   — the mechanism and the default font mapping.
 */
export type FontResolver = (query: PdfFontQuery) => FontResolution | null;

const containsAny = (value: string, patterns: string[]): boolean => patterns.some((p) => value.includes(p));

const isItalicQuery = (query: PdfFontQuery, face: string): boolean =>
  query.isItalic || containsAny(face, ['italic', 'oblique']);

/** Normalizes font weights and style hints to a Google Fonts weight. */
function getFontWeight(query: PdfFontQuery, face: string): number {
  if (query.weight >= 100 && query.weight <= 900) return query.weight;
  if (containsAny(face, ['black', 'heavy'])) return 900;
  if (containsAny(face, ['extrabold', 'extra bold', 'ultrabold', 'ultra bold'])) return 800;
  if (containsAny(face, ['semibold', 'semi bold', 'demibold', 'demi bold'])) return 600;
  if (containsAny(face, ['bold'])) return 700;
  if (containsAny(face, ['medium'])) return 500;
  if (containsAny(face, ['light'])) return 300;
  if (containsAny(face, ['thin'])) return 100;
  return 400;
}

/** Returns the closest available font weight from the table. */
function getNearestWeight(table: WeightTable, weight: number): GoogleFontsFile | null {
  let best: GoogleFontsFile | null = null;
  let bestDistance = Infinity;
  for (const key of Object.keys(table)) {
    const w = Number(key);
    const distance = Math.abs(w - weight);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = table[w]!;
    }
  }
  return best;
}

/** Converts compact Google Fonts family names to the names stored in font files. */
function getPdfFaceName(faceName: string): string {
  const joinNoto = (baseName: string, suffix: string): string => {
    if (suffix.length === 0) return baseName;
    if (['SC', 'TC', 'JP', 'KR'].includes(suffix)) return `${baseName} ${suffix}`;
    const words = suffix.replace(/-/g, '').replace(/[A-Z][a-z0-9]*/g, (m) => ` ${m}`);
    return `${baseName}${words}`;
  };
  if (faceName.startsWith('NotoSans')) {
    const suffix = faceName.substring('NotoSans'.length);
    if (suffix === '-Italic') return 'Noto Sans';
    return joinNoto('Noto Sans', suffix);
  }
  if (faceName.startsWith('NotoSerif')) {
    const suffix = faceName.substring('NotoSerif'.length);
    if (suffix === '-Italic') return 'Noto Serif';
    return joinNoto('Noto Serif', suffix);
  }
  if (faceName === 'NotoNaskhArabic') return 'Noto Naskh Arabic';
  return faceName;
}

/** Selects metric-compatible fonts for PDF standard/Core font families. */
function getStandardFontTable(query: PdfFontQuery): WeightTable | null {
  const face = query.face.toLowerCase();
  const italic = isItalicQuery(query, face);
  if (containsAny(face, ['courier', 'mono', 'consolas', 'menlo', 'monaco']) || isFixed(query)) {
    return italic ? cousineItalic : cousine;
  }
  if (containsAny(face, ['arial', 'helvetica', 'sans', 'verdana', 'tahoma'])) {
    return italic ? arimoItalic : arimo;
  }
  if (containsAny(face, ['times', 'serif', 'georgia', 'garamond', 'minion'])) {
    return italic ? tinosItalic : tinos;
  }
  return null;
}

/** Selects a broad Latin Noto fallback when no metric-compatible family matches. */
function getLatinCoverageFontTable(query: PdfFontQuery): WeightTable {
  const face = query.face.toLowerCase();
  const italic = isItalicQuery(query, face);
  const hasSansHint = containsAny(face, ['sans']);
  return isRoman(query) || (!hasSansHint && containsAny(face, ['serif']))
    ? italic
      ? notoSerifItalic
      : notoSerif
    : italic
      ? notoSansItalic
      : notoSans;
}

/** Resolves PDF standard and common Core fonts to metric-compatible Google Fonts. */
function resolveStandardFont(query: PdfFontQuery): GoogleFontsFile | null {
  if (query.charset !== Charset.ansi && query.charset !== Charset.default_) return null;
  const table = getStandardFontTable(query);
  if (!table) return null;
  return getNearestWeight(table, getFontWeight(query, query.face.toLowerCase()));
}

/** Resolves the query to a Noto family chosen by charset and style. */
function resolveNotoFont(query: PdfFontQuery): GoogleFontsFile | null {
  const serifTables: Partial<Record<number, WeightTable>> = {
    [Charset.gb2312]: notoSerifSc,
    [Charset.chineseBig5]: notoSerifTc,
    [Charset.shiftJis]: notoSerifJp,
    [Charset.hangul]: notoSerifKr,
    [Charset.thai]: notoSerifThai,
    [Charset.hebrew]: notoSerifHebrew,
    [Charset.arabic]: notoNaskhArabic,
  };
  const sansTables: Partial<Record<number, WeightTable>> = {
    [Charset.gb2312]: notoSansSc,
    [Charset.chineseBig5]: notoSansTc,
    [Charset.shiftJis]: notoSansJp,
    [Charset.hangul]: notoSansKr,
    [Charset.thai]: notoSansThai,
    [Charset.hebrew]: notoSansHebrew,
    [Charset.arabic]: notoSansArabic,
  };

  let table: WeightTable | null;
  const roman = isRoman(query);
  switch (query.charset) {
    case Charset.symbol:
      table = null;
      break;
    case Charset.ansi:
    case Charset.default_:
      table = getLatinCoverageFontTable(query);
      break;
    case Charset.greek:
    case Charset.vietnamese:
    case Charset.cyrillic:
    case Charset.easternEuropean:
      table = roman
        ? query.isItalic
          ? notoSerifItalic
          : notoSerif
        : query.isItalic
          ? notoSansItalic
          : notoSans;
      break;
    default:
      table = (roman ? serifTables : sansTables)[query.charset] ?? null;
      break;
  }
  if (!table) return null;
  return getNearestWeight(table, getFontWeight(query, query.face.toLowerCase()));
}

const fileToResolution = (font: GoogleFontsFile): FontResolution => ({
  resolvedFace: getPdfFaceName(font.faceName),
  url: `https://fonts.gstatic.com/s/a/${font.hash}.ttf`,
  expectedLength: font.length,
});

/**
 * The default {@link FontResolver}: tries metric-compatible substitutes for PDF
 * standard/Core fonts first (Arimo/Tinos/Cousine), then a Noto family chosen by
 * charset and style. All files are served from fonts.gstatic.com with
 * `access-control-allow-origin: *`.
 *
 * @returns A {@link FontResolution}, or `null` when no substitute is known
 *   (e.g. symbol fonts).
 *
 * @see [Missing-font fallback](https://github.com/espresso3389/pdfrx_web/blob/master/docs/FONT-FALLBACK.md)
 *   — which font is used for which query (charset, weight, and style rules).
 */
export const googleFontsResolver: FontResolver = (query) => {
  const standard = resolveStandardFont(query);
  if (standard) return fileToResolution(standard);
  const noto = resolveNotoFont(query);
  if (noto) return fileToResolution(noto);
  return null;
};
