import type { PdfFontQuery } from '@pdfrx/engine';

export type FontFamilyClass = 'serif' | 'sans' | 'mono' | 'script' | 'decorative' | 'unknown';

const exactFamilies: Readonly<Record<string, FontFamilyClass>> = {
  // Simplified Chinese
  stsong: 'serif',
  simsun: 'serif',
  nsimsun: 'serif',
  songtisc: 'serif',
  fangsong: 'serif',
  stfangsong: 'serif',
  kaiti: 'serif',
  stkaiti: 'serif',
  dfkaisb: 'serif',
  'sourcehanserifsc': 'serif',
  'notoserifcjksc': 'serif',
  stheiti: 'sans',
  simhei: 'sans',
  microsoftyahei: 'sans',
  dengxian: 'sans',
  pingfangsc: 'sans',
  'sourcehansanssc': 'sans',
  'notosanscjksc': 'sans',

  // Traditional Chinese
  mingliu: 'serif',
  pmingliu: 'serif',
  songtitc: 'serif',
  'sourcehanseriftc': 'serif',
  'notoserifcjktc': 'serif',
  microsoftjhenghei: 'sans',
  pingfangtc: 'sans',
  heititc: 'sans',
  'sourcehansanstc': 'sans',
  'notosanscjktc': 'sans',

  // Japanese
  msmincho: 'serif',
  mspmincho: 'serif',
  yumincho: 'serif',
  hiraginomincho: 'serif',
  kozukamincho: 'serif',
  ryumin: 'serif',
  heiseimin: 'serif',
  'sourcehanserifjp': 'serif',
  'notoserifcjkjp': 'serif',
  msgothic: 'sans',
  mspgothic: 'sans',
  yugothic: 'sans',
  hiraginokakugothic: 'sans',
  kozukagothic: 'sans',
  heiseikakugothic: 'sans',
  meiryo: 'sans',
  'sourcehansansjp': 'sans',
  'notosanscjkjp': 'sans',

  // Korean
  batang: 'serif',
  batangche: 'serif',
  gungsuh: 'serif',
  nanummyeongjo: 'serif',
  'sourcehanserifkr': 'serif',
  'notoserifcjkkr': 'serif',
  dotum: 'sans',
  dotumche: 'sans',
  gulim: 'sans',
  gulimche: 'sans',
  malgungothic: 'sans',
  nanumgothic: 'sans',
  'sourcehansanskr': 'sans',
  'notosanscjkkr': 'sans',
};

const styleSuffixes =
  /(?:thin|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)+$/;

/**
 * Reduces PDF/PostScript face names to a stable lookup key.
 *
 * Besides subset prefixes, PDF CJK names commonly carry a CMap suffix such as
 * `-UniGB-UCS2-H`; that suffix describes encoding, not the font family.
 */
export function normalizeFontFamilyName(face: string): string {
  let normalized = face
    .normalize('NFKC')
    .trim()
    .replace(/^\//, '')
    .replace(/^[A-Z]{6}\+/i, '')
    .replace(
      /-(?:uni)?(?:gb|cns|jis|ks|ucs2|utf16|identity)(?:[-_](?:ucs2|utf16|h|v|\d+))*$/i,
      '',
    )
    .toLowerCase()
    .replace(/[\s,._-]+/g, '');

  // Style suffixes can be stacked (`SemiboldItalic`).
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(styleSuffixes, '');
  } while (normalized !== previous);
  return normalized;
}

function classifyKnownName(normalized: string): FontFamilyClass {
  const exact = exactFamilies[normalized];
  if (exact) return exact;

  // These terms are established family conventions across CJK foundries.
  if (/(?:gothic|goth|kakugo|heiti|hei|dotum|gulim)/.test(normalized)) return 'sans';
  if (/(?:mincho|myeongjo|mingliu|ming|songti|song|batang|kaiti)/.test(normalized)) return 'serif';

  if (/(?:courier|mono|consolas|menlo|monaco)/.test(normalized)) return 'mono';
  if (/(?:arial|helvetica|sans|verdana|tahoma)/.test(normalized)) return 'sans';
  if (/(?:times|serif|georgia|garamond|minion)/.test(normalized)) return 'serif';
  return 'unknown';
}

/**
 * Classifies a missing font, preferring its normalized family name over the
 * frequently incomplete PDFium pitch/family hint.
 */
export function classifyFontFamily(query: PdfFontQuery): FontFamilyClass {
  const byName = classifyKnownName(normalizeFontFamilyName(query.face));
  if (byName !== 'unknown') return byName;
  if ((query.pitchFamily & 0x01) !== 0) return 'mono';

  switch (query.pitchFamily & 0xf0) {
    case 0x10:
      return 'serif';
    case 0x20:
      return 'sans';
    case 0x30:
      return 'mono';
    case 0x40:
      return 'script';
    case 0x50:
      return 'decorative';
    default:
      return 'unknown';
  }
}
