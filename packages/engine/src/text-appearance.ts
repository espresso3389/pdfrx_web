import type { PdfAnnotationSpec } from './types.js';

/** RGBA image used for one rasterized emoji run in a FreeText appearance. */
export interface PdfEmojiImage {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly pixels: Uint8Array;
  /** Logical advance in PDF points. Defaults to `width / scale`. */
  readonly advance?: number;
}

/** Loads an encoded emoji asset for one complete grapheme cluster. */
export interface PdfEmojiAssetSource {
  load(grapheme: string, signal?: AbortSignal): Promise<Uint8Array | null>;
}

/** Cache shared by downloadable text-appearance assets. */
export interface PdfTextAssetCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
}

/** Rasterizes one complete emoji grapheme for a FreeText appearance. */
export type PdfEmojiRenderer = (
  grapheme: string,
  fontSize: number,
  signal?: AbortSignal,
) => Promise<PdfEmojiImage | null> | PdfEmojiImage | null;

/** Measures a text run in PDF points. */
export type PdfTextMeasureProvider = (text: string, fontSize: number, fontFace: string | null) => number;

/** Registers or resolves the font used for one PDFium Windows charset. */
export type PdfFreeTextFontResolver = (charset: number) => Promise<string | null> | string | null;

/** Services used by {@link prepareFreeTextAppearance}. */
export interface PdfTextAppearanceServices {
  /** Text measurement. The default is a deterministic approximation suitable for headless runtimes. */
  measureText?: PdfTextMeasureProvider;
  /** Script-specific font registration. Omit it to let PDFium use its default font. */
  resolveFont?: PdfFreeTextFontResolver;
  /** Emoji rasterization. The default uses native browser emoji, then a downloadable Noto PNG. */
  renderEmoji?: PdfEmojiRenderer | null;
}

/** Options for {@link prepareFreeTextAppearance}. */
export interface PdfFreeTextAppearanceOptions {
  /**
   * BCP-47 language hint(s), used mainly to disambiguate Han-only text.
   *
   * Kana and Hangul already identify Japanese and Korean, so a hint is
   * normally unnecessary for them. In a browser, `navigator.languages` and
   * `navigator.language` are consulted automatically after explicit hints.
   * Server integrations should pass the document language, the signed-in
   * user's locale, or a parsed `Accept-Language` preference. The first
   * applicable `ja`, `ko`, or `zh` hint wins.
   */
  language?: string | readonly string[];
  services?: PdfTextAppearanceServices;
  signal?: AbortSignal;
}

/** Options for {@link createNotoEmojiPngSource}. */
export interface PdfNotoEmojiSourceOptions {
  /**
   * Directory containing Noto's `emoji_u<codepoints>.png` files.
   * Defaults to a version-pinned jsDelivr URL; point this at a local mirror for
   * offline or restricted environments.
   */
  baseUrl?: string;
  cache?: PdfTextAssetCache;
}

/** Options for {@link createDefaultEmojiRenderer}. */
export interface PdfDefaultEmojiRendererOptions extends PdfNotoEmojiSourceOptions {
  source?: PdfEmojiAssetSource;
  /** Raster scale for native browser emoji. Default `3`. */
  scale?: number;
}

type FreeTextFontKind = number | 'symbols';
type FreeTextRunKind = FreeTextFontKind | 'latin' | 'neutral';

const FREE_TEXT_FONT_SIZE = 12;
const FREE_TEXT_PADDING = 3;
const NOTO_EMOJI_REVISION = '8998f5dd683424a73e2314a8c1f1e359c19e8742';
export const defaultNotoEmojiPngBaseUrl =
  `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@${NOTO_EMOJI_REVISION}/png/128/`;

/** Simple process-local byte cache. */
export class PdfMemoryTextAssetCache implements PdfTextAssetCache {
  readonly #entries = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    return this.#entries.get(key)?.slice() ?? null;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    this.#entries.set(key, data.slice());
  }
}

/** Browser IndexedDB cache for downloaded text-appearance assets. */
export class PdfIndexedDbTextAssetCache implements PdfTextAssetCache {
  readonly #databaseName: string;
  #database: Promise<IDBDatabase> | null = null;

  constructor(databaseName = 'pdfrx.text-assets') {
    this.#databaseName = databaseName;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const database = await this.#open();
    return new Promise((resolve, reject) => {
      const request = database.transaction('assets', 'readonly').objectStore('assets').get(key);
      request.onsuccess = () => {
        const value = request.result as { data?: ArrayBuffer } | undefined;
        resolve(value?.data ? new Uint8Array(value.data) : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const database = await this.#open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('assets', 'readwrite');
      transaction.objectStore('assets').put({ key, data: data.slice().buffer });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  #open(): Promise<IDBDatabase> {
    if (!this.#database) {
      this.#database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.#databaseName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('assets')) {
            request.result.createObjectStore('assets', { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Opening IndexedDB ${this.#databaseName} was blocked`));
      });
    }
    return this.#database;
  }
}

const defaultEmojiMemoryCache = new PdfMemoryTextAssetCache();
const defaultEmojiPersistentCache =
  typeof indexedDB === 'undefined' ? null : new PdfIndexedDbTextAssetCache();
const defaultEmojiAssetCache: PdfTextAssetCache = {
  async get(key) {
    const memory = await defaultEmojiMemoryCache.get(key);
    if (memory) return memory;
    if (!defaultEmojiPersistentCache) return null;
    try {
      const persistent = await defaultEmojiPersistentCache.get(key);
      if (persistent) await defaultEmojiMemoryCache.put(key, persistent);
      return persistent;
    } catch {
      return null;
    }
  },
  async put(key, data) {
    await defaultEmojiMemoryCache.put(key, data);
    try {
      await defaultEmojiPersistentCache?.put(key, data);
    } catch {
      // IndexedDB may be disabled or quota-limited; the memory cache remains usable.
    }
  },
};

function emojiCodePoints(grapheme: string, keepVariationSelector: boolean): string {
  return [...grapheme]
    .map((character) => character.codePointAt(0)!)
    .filter((codePoint) => keepVariationSelector || codePoint !== 0xfe0f)
    .map((codePoint) => codePoint.toString(16))
    .join('_');
}

/**
 * Creates the default downloadable Noto Emoji PNG source.
 *
 * Assets are requested lazily, one grapheme at a time, and are not distributed
 * with `@pdfrx/engine`. The URL is pinned to one Noto Emoji revision.
 */
export function createNotoEmojiPngSource(options: PdfNotoEmojiSourceOptions = {}): PdfEmojiAssetSource {
  const configuredBaseUrl = (options.baseUrl ?? defaultNotoEmojiPngBaseUrl).replace(/\/?$/, '/');
  const runtimeBaseUrl =
    typeof document !== 'undefined'
      ? document.baseURI
      : typeof location !== 'undefined'
        ? location.href
        : undefined;
  const baseUrl = runtimeBaseUrl ? new URL(configuredBaseUrl, runtimeBaseUrl).toString() : configuredBaseUrl;
  const cache = options.cache ?? defaultEmojiAssetCache;
  const pending = new Map<string, Promise<Uint8Array | null>>();
  return {
    async load(grapheme, signal) {
      const candidates = [...new Set([emojiCodePoints(grapheme, false), emojiCodePoints(grapheme, true)])].filter(Boolean);
      for (const codePoints of candidates) {
        const url = new URL(`emoji_u${codePoints}.png`, baseUrl).toString();
        const cached = await cache.get(url);
        if (cached) return cached;
        let request = pending.get(url);
        if (!request) {
          request = fetch(url, { signal })
            .then(async (response) => {
              if (response.status === 404) return null;
              if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
              const data = new Uint8Array(await response.arrayBuffer());
              await cache.put(url, data);
              return data;
            })
            .catch((error: unknown) => {
              if (signal?.aborted) throw error;
              console.warn(`pdfrx: failed to load emoji asset ${url}:`, error);
              return null;
            })
            .finally(() => pending.delete(url));
          pending.set(url, request);
        }
        const data = await request;
        if (data) return data.slice();
      }
      return null;
    },
  };
}

let nativeEmojiFamilyPromise: Promise<string | null> | null = null;

function nativeEmojiFontFamily(): Promise<string | null> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    return Promise.resolve(null);
  }
  if (!nativeEmojiFamilyPromise) {
    nativeEmojiFamilyPromise = (async () => {
      const candidates = ['Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'];
      for (let index = 0; index < candidates.length; index++) {
        const alias = `Pdfrx Native Emoji ${index}`;
        try {
          const font = new FontFace(alias, `local("${candidates[index]}")`);
          await font.load();
          document.fonts.add(font);
          return alias;
        } catch {
          // Try the next platform family.
        }
      }
      return null;
    })();
  }
  return nativeEmojiFamilyPromise;
}

function renderNativeEmoji(grapheme: string, fontSize: number, family: string, scale: number): PdfEmojiImage | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) return null;
  measure.font = `${fontSize}px "${family}"`;
  const advance = Math.max(fontSize, Math.ceil(measure.measureText(grapheme).width + 2));
  const logicalHeight = Math.ceil(fontSize * 1.2);
  canvas.width = advance * scale;
  canvas.height = logicalHeight * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(scale, scale);
  context.font = `${fontSize}px "${family}"`;
  context.textBaseline = 'alphabetic';
  context.fillText(grapheme, 1, fontSize);
  return {
    width: canvas.width,
    height: canvas.height,
    scale,
    pixels: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data),
    advance,
  };
}

/**
 * Creates the cross-runtime default emoji renderer.
 *
 * Browsers first use an explicitly available native color-emoji family.
 * Otherwise (including headless server runtimes), a version-pinned Noto Emoji
 * PNG is downloaded and decoded without a DOM or native image dependency.
 */
export function createDefaultEmojiRenderer(options: PdfDefaultEmojiRendererOptions = {}): PdfEmojiRenderer {
  const source = options.source ?? createNotoEmojiPngSource(options);
  const scale = options.scale ?? 3;
  return async (grapheme, fontSize, signal) => {
    const family = await nativeEmojiFontFamily();
    const native = family ? renderNativeEmoji(grapheme, fontSize, family, scale) : null;
    if (native) return native;
    const encoded = await source.load(grapheme, signal);
    if (!encoded) return null;
    const decoded = await decodeRgbaPng(encoded);
    return {
      ...decoded,
      scale: decoded.width / fontSize,
      advance: fontSize,
    };
  };
}

const defaultEmojiRenderer = createDefaultEmojiRenderer();

function freeTextRunKind(text: string): FreeTextRunKind {
  if (/\p{Extended_Pictographic}|[\u2000-\u2bff\ufe0f]/u.test(text)) return 'symbols';
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 128;
  if (/\p{Script=Hangul}/u.test(text)) return 129;
  if (/\p{Script=Han}/u.test(text)) return 134;
  if (/\p{Script=Arabic}/u.test(text)) return 178;
  if (/\p{Script=Hebrew}/u.test(text)) return 177;
  if (/\p{Script=Thai}/u.test(text)) return 222;
  if (/\p{Script=Cyrillic}/u.test(text)) return 204;
  if (/\p{Script=Greek}/u.test(text)) return 161;
  if (/\p{Script=Latin}|[\u0000-\u00ff]/u.test(text)) return 'latin';
  if (/\p{Script=Common}|\p{Script=Inherited}/u.test(text)) return 'neutral';
  return 1;
}

function approximateTextWidth(text: string, fontSize: number): number {
  return [...text].reduce((width, character) => {
    return width + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character) ? fontSize : fontSize * 0.6);
  }, 0);
}

/** Creates a Canvas-backed text measurer when a DOM is available. */
export function createCanvasTextMeasureProvider(fontFamily = 'Arial, sans-serif'): PdfTextMeasureProvider {
  if (typeof document === 'undefined') return (text, fontSize) => approximateTextWidth(text, fontSize);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return (text, fontSize) => approximateTextWidth(text, fontSize);
  return (text, fontSize, fontFace) => {
    context.font = `${fontSize}px ${fontFace ? `"${fontFace}", ` : ''}${fontFamily}`;
    return context.measureText(text).width;
  };
}

function wrapFreeText(text: string, width: number, fontSize: number, measure: PdfTextMeasureProvider): string[] {
  const maxWidth = Math.max(1, width - FREE_TEXT_PADDING * 2);
  const result: string[] = [];
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const fits = (value: string): boolean => measure(value, fontSize, null) <= maxWidth;
  const pushBrokenToken = (prefix: string, token: string): string => {
    let line = prefix;
    const graphemes =
      typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token)].map((part) => part.segment)
        : [...token];
    for (const grapheme of graphemes) {
      if (line && !fits(line + grapheme)) {
        result.push(line.trimEnd());
        line = grapheme;
      } else {
        line += grapheme;
      }
    }
    return line;
  };
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph === '') {
      result.push('');
      continue;
    }
    const tokens = segmenter ? [...segmenter.segment(paragraph)].map((item) => item.segment) : paragraph.split(/(\s+)/u);
    let line = '';
    for (const token of tokens) {
      if (fits(line + token)) {
        line += token;
      } else if (line) {
        result.push(line.trimEnd());
        line = fits(token) ? token.trimStart() : pushBrokenToken('', token.trimStart());
      } else {
        line = pushBrokenToken('', token);
      }
    }
    result.push(line.trimEnd());
  }
  return result.length ? result : [''];
}

function resolveCjkKinds(kinds: FreeTextRunKind[], languages: readonly string[]): void {
  if (kinds.includes(128)) {
    for (let index = 0; index < kinds.length; index++) if (kinds[index] === 134) kinds[index] = 128;
  } else if (kinds.includes(129)) {
    for (let index = 0; index < kinds.length; index++) if (kinds[index] === 134) kinds[index] = 129;
  } else {
    const locale = languages.find((tag) => /^(?:ja|ko|zh)(?:-|$)/i.test(tag));
    const charset =
      locale && /^ja(?:-|$)/i.test(locale)
        ? 128
        : locale && /^ko(?:-|$)/i.test(locale)
          ? 129
          : locale && /^zh(?:-(?:hant|tw|hk|mo))(?:-|$)/i.test(locale)
            ? 136
            : 134;
    for (let index = 0; index < kinds.length; index++) if (kinds[index] === 134) kinds[index] = charset;
  }
  for (let index = 0; index < kinds.length; index++) {
    if (kinds[index] !== 'neutral') continue;
    let previous: FreeTextRunKind | undefined;
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (kinds[cursor] !== 'neutral') {
        previous = kinds[cursor];
        break;
      }
    }
    kinds[index] = previous ?? kinds.slice(index + 1).find((kind) => kind !== 'neutral') ?? 'latin';
  }
}

/**
 * Builds a language-aware, wrapped FreeText appearance without requiring a
 * {@link PdfDocument} instance.
 *
 * Most callers that already have an open document should use
 * {@link PdfDocument.prepareFreeTextAppearance}. This standalone form is useful
 * for preparing specs in an adapter or service layer. It performs the same
 * operation and mutates `spec.fontFace`, `spec.appearanceLines`, and
 * `spec.appearanceRuns`.
 *
 * `options.language` is a hint, not a required field. Kana and Hangul identify
 * Japanese and Korean directly; in browsers, `navigator.languages` and
 * `navigator.language` are used automatically. Pass an explicit language for
 * ambiguous Han-only content, to override the browser preference, or in a
 * server runtime where no browser locale exists. A server commonly gets it
 * from document metadata, the authenticated user's locale, or a parsed
 * `Accept-Language` preference.
 *
 * @example
 * ```ts
 * const spec: PdfAnnotationSpec = {
 *   subtype: 'freeText',
 *   rect: { left: 40, bottom: 700, right: 260, top: 750 },
 *   contents: '繁體中文 👋',
 * };
 *
 * // Explicit because this Han-only text is prepared outside a browser.
 * await prepareFreeTextAppearance(spec, { language: 'zh-Hant' });
 * await page.addAnnotation(spec);
 * ```
 *
 * The defaults use deterministic approximate text measurement outside the
 * browser, PDFium's default font when no `resolveFont` service is supplied,
 * and native-browser or downloadable Noto PNG emoji rendering. Pass
 * `options.services` when the runtime requires exact measurement, registered
 * script fonts, offline emoji assets, or a custom renderer.
 *
 * For provider and deployment examples, read the
 * [Text, language, and emoji appearance guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/TEXT-APPEARANCE.md).
 */
export async function prepareFreeTextAppearance(
  spec: PdfAnnotationSpec,
  options: PdfFreeTextAppearanceOptions = {},
): Promise<void> {
  if (spec.subtype !== 'freeText' || !spec.rect || spec.contents == null) return;
  const fontSize = spec.fontSize ?? FREE_TEXT_FONT_SIZE;
  const measure = options.services?.measureText ?? approximateTextWidth;
  const renderEmoji = options.services?.renderEmoji === undefined ? defaultEmojiRenderer : options.services.renderEmoji;
  const requested = options.language === undefined ? [] : typeof options.language === 'string' ? [options.language] : options.language;
  const browser =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [];
  const languages = [...requested, ...browser];
  spec.appearanceLines = wrapFreeText(
    spec.contents,
    spec.rect.right - spec.rect.left - (spec.borderWidth ?? 0) * 2,
    fontSize,
    measure,
  );
  spec.appearanceRuns = [];
  const segmenter =
    typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  for (const line of spec.appearanceLines) {
    const graphemes = segmenter ? [...segmenter.segment(line)].map((part) => part.segment) : [...line];
    const kinds = graphemes.map(freeTextRunKind);
    resolveCjkKinds(kinds, languages);
    const grouped: { text: string; kind: FreeTextRunKind }[] = [];
    for (let index = 0; index < graphemes.length; index++) {
      const text = graphemes[index]!;
      const kind = kinds[index]!;
      const last = grouped[grouped.length - 1];
      // Each emoji grapheme maps to one downloadable asset. Keep adjacent
      // emoji separate while retaining every ZWJ/variation sequence atomically.
      if (kind !== 'symbols' && last?.kind === kind) last.text += text;
      else grouped.push({ text, kind });
    }
    let x = 0;
    const runs: NonNullable<PdfAnnotationSpec['appearanceRuns']>[number] = [];
    for (const group of grouped) {
      const fontFace =
        typeof group.kind === 'number' ? (await options.services?.resolveFont?.(group.kind)) ?? null : null;
      const image = group.kind === 'symbols' && renderEmoji
        ? (await renderEmoji(group.text, fontSize, options.signal)) ?? undefined
        : undefined;
      runs.push({
        text: group.text,
        fontFace,
        x,
        ...(image ? { image: { width: image.width, height: image.height, scale: image.scale, pixels: image.pixels } } : {}),
      });
      x += image?.advance ?? measure(group.text, fontSize, fontFace);
    }
    const availableWidth = Math.max(0, spec.rect.right - spec.rect.left - (spec.borderWidth ?? 0) * 2 - 6);
    const offset =
      spec.textAlign === 'right'
        ? Math.max(0, availableWidth - x)
        : spec.textAlign === 'center'
          ? Math.max(0, (availableWidth - x) / 2)
          : 0;
    if (offset > 0) for (const run of runs) run.x += offset;
    spec.appearanceRuns.push(runs);
  }
  spec.fontFace = spec.appearanceRuns.flat().find((run) => run.fontFace)?.fontFace ?? null;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('PNG decoding requires DecompressionStream support or a custom PdfEmojiRenderer');
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes the 8-bit, non-interlaced RGB/RGBA PNGs used by Noto Emoji. */
export async function decodeRgbaPng(data: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (data.length < 33 || signature.some((value, index) => data[index] !== value)) throw new Error('Invalid PNG');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > data.length) throw new Error('Truncated PNG chunk');
    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      if (data[start + 8] !== 8 || data[start + 12] !== 0) {
        throw new Error('Only 8-bit, non-interlaced PNG is supported');
      }
      colorType = data[start + 9]!;
    } else if (type === 'IDAT') {
      idat.push(data.slice(start, end));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  if (!(width > 0 && height > 0) || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG color type ${colorType}`);
  }
  const compressedLength = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of idat) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }
  const inflated = await inflate(compressed);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  if (inflated.length < (stride + 1) * height) throw new Error('Truncated PNG pixel data');
  const raw = new Uint8Array(stride * height);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[source++]!;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = inflated[source++]!;
      const left = x >= channels ? raw[row + x - channels]! : 0;
      const up = y > 0 ? raw[row + x - stride]! : 0;
      const upLeft = y > 0 && x >= channels ? raw[row + x - stride - channels]! : 0;
      const predictor =
        filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upLeft) : -1;
      if (predictor < 0) throw new Error(`Unsupported PNG filter ${filter}`);
      raw[row + x] = (value + predictor) & 0xff;
    }
  }
  if (colorType === 6) return { width, height, pixels: raw };
  const pixels = new Uint8Array(width * height * 4);
  for (let input = 0, output = 0; input < raw.length; input += 3, output += 4) {
    pixels[output] = raw[input]!;
    pixels[output + 1] = raw[input + 1]!;
    pixels[output + 2] = raw[input + 2]!;
    pixels[output + 3] = 255;
  }
  return { width, height, pixels };
}
