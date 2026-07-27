# Text, language, and emoji appearance

pdfrx separates text already stored in a PDF from text newly authored in a
FreeText annotation:

- PDF text extraction is decoded by PDFium and exposed as JavaScript strings
  with one rectangle per UTF-16 code unit.
- FreeText authoring starts with a Unicode string and must choose fonts, wrap
  lines, preserve grapheme clusters, and build a PDF appearance.

The second path is implemented by `@pdfrx/engine`, so direct engine users,
`@pdfrx/viewer`, and `@pdfrx/react` share the same script, language, wrapping,
and emoji decisions.

## Preparing FreeText

Call
[`PdfDocument.prepareFreeTextAppearance()`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html#preparefreetextappearance-1)
before adding or updating a FreeText annotation:

```ts
const spec = {
  subtype: 'freeText' as const,
  rect: { left: 40, bottom: 700, right: 260, top: 750 },
  contents: 'Hello 😀 日本語',
};

await document.prepareFreeTextAppearance(spec, { language: 'ja' });
await document.pages[0]!.addAnnotation(spec);
```

The method updates `appearanceLines`, `appearanceRuns`, and `fontFace` on the
supplied spec. It segments text into complete grapheme clusters, detects
scripts, groups adjacent clusters into font runs, and keeps emoji sequences
such as family ZWJ sequences, skin tones, flags, and variation sequences
atomic.

Script-specific font bytes are deliberately supplied through `resolveFont`.
`@pdfrx/viewer` connects that provider to its existing downloadable-font
fallback path. A direct engine integration gets the same segmentation,
language, layout, and emoji behavior, but should provide `resolveFont` when its
PDFium environment does not already contain suitable CJK or other script
fonts.

Kana and Hangul make adjacent Han characters Japanese or Korean respectively.
Han-only text uses the first applicable `language` hint (`ja`, `ko`, or a
Simplified/Traditional `zh` tag); absent a hint, browser languages are
considered, then Simplified Chinese is the fallback.

The viewer calls this engine API for every FreeText edit. Its
`freeTextLanguage` option supplies the language hint; React forwards `locale`
when no more specific hint was configured.

## Emoji fallback

Emoji are rasterized into RGBA image runs rather than written as PDF font
glyphs. This avoids relying on a PDF consumer to support CBDT, COLR, sbix, ZWJ
shaping, or the same system emoji font.

The default renderer uses this order:

1. In a browser, use an explicitly available `Segoe UI Emoji`,
   `Apple Color Emoji`, or `Noto Color Emoji` family.
2. Otherwise, lazily download the matching 128-pixel Noto Emoji PNG.
3. Decode the PNG in `@pdfrx/engine` and store the result in the annotation's
   normal appearance.

Noto assets are **not included in the npm package**. The default URL is pinned
to one revision of the official
[googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji) repository
and is served through jsDelivr. Only emoji actually used by the document are
requested.

The official PNG tree does not include regional-flag artwork. Browsers can
normally render flags through their native emoji font. For deterministic
browserless flag rendering, provide a custom source or renderer (for example,
one backed by Noto's separately distributed region-flag SVG assets). The
engine still treats each regional-indicator flag sequence as one grapheme.

Browser downloads use a memory cache backed by IndexedDB
(`pdfrx.text-assets`). Server runtimes use a process-local memory cache by
default. Concurrent requests for the same asset are deduplicated.

The fallback requires outbound HTTPS access to `cdn.jsdelivr.net`. Browser
deployments must also permit that origin in `connect-src`; use a local mirror
when CORS, CSP, privacy policy, or offline operation disallows it.

## Linux native-font setup

Installing Noto Color Emoji lets a browser use the native path without
downloading per-emoji assets. For example, Debian/Ubuntu images commonly use:

```dockerfile
RUN apt-get update \
 && apt-get install -y fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
```

Package names vary by distribution. The font must be visible to the browser
under the family name `Noto Color Emoji`; installing it for a Node process
alone does not add a Canvas implementation to Node, so headless Node continues
to use the downloadable PNG path.

## Hosting Noto assets yourself

Download the `png/128` directory from the same Noto Emoji revision used by
pdfrx, serve it from your application or private CDN, and create a source with
that base URL:

```ts
import {
  createDefaultEmojiRenderer,
  createNotoEmojiPngSource,
} from '@pdfrx/engine';

const source = createNotoEmojiPngSource({
  baseUrl: 'https://assets.example.com/noto-emoji/png/128/',
});

const renderEmoji = createDefaultEmojiRenderer({ source });

await document.prepareFreeTextAppearance(spec, {
  services: { renderEmoji },
});
```

The directory must retain Noto's file names, such as
`emoji_u1f468_200d_1f469_200d_1f467.png`. A `file:` URL is not universally
fetchable; server applications that read directly from a filesystem should
implement `PdfEmojiAssetSource.load()` and pass it to
`createDefaultEmojiRenderer()`.

## Persistent server cache

Server applications choose their own persistence policy by implementing
[`PdfTextAssetCache`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfTextAssetCache.html).
This avoids assuming filesystem access in serverless,
read-only, multi-process, or edge environments.

```ts
import {
  createNotoEmojiPngSource,
  type PdfTextAssetCache,
} from '@pdfrx/engine';

const cache: PdfTextAssetCache = {
  async get(key) {
    return database.getBinary(key);
  },
  async put(key, data) {
    await database.putBinary(key, data);
  },
};

const source = createNotoEmojiPngSource({ cache });
```

The cache key is the complete, version-pinned asset URL. Changing the Noto
revision therefore cannot silently reuse bytes from another version.

## Custom rendering and disabling downloads

Applications can replace just the environment-dependent services while keeping
engine segmentation and layout:

```ts
await document.prepareFreeTextAppearance(spec, {
  language: ['ja-JP', 'en'],
  services: {
    measureText: customMeasureText,
    resolveFont: customFreeTextFontResolver,
    renderEmoji: customEmojiRenderer,
  },
});
```

`PdfEmojiRenderer` may use SVG, PNG, a native color font, an application emoji
set, or pre-rendered RGBA pixels. `PdfEmojiAssetSource` is useful when only
asset loading differs, and `PdfTextAssetCache` controls storage.

Set `renderEmoji: null` to disable both native emoji rasterization and automatic
Noto downloads:

```ts
await document.prepareFreeTextAppearance(spec, {
  services: { renderEmoji: null },
});
```

Viewer and React applications pass the same overrides through
`textAppearanceServices`:

```tsx
<PdfrxViewerApp
  src="/manual.pdf"
  textAppearanceServices={{ renderEmoji: customEmojiRenderer }}
/>
```

When emoji rendering is disabled or an asset cannot be resolved, the run
remains text-only and the resulting glyph depends on PDFium's available font.

## Licensing and operational behavior

Noto Emoji is licensed under the SIL Open Font License 1.1. pdfrx does not
redistribute its font, PNG, or SVG files; the default source downloads selected
files at runtime. Applications using the default or a mirror should include
Noto's license notice as required by their distribution and deployment model.

Automatic network access is limited to preparing a FreeText annotation that
actually contains an emoji and only when no supported native browser emoji
family is available. Opening or rendering an existing PDF does not download
Noto emoji assets through this mechanism.
