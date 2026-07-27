# Missing-font fallback via Google Fonts

The WASM rendering engine ships with **no system fonts**. A PDF that does not
embed its fonts — which includes anything relying on the "standard 14" Core
fonts (Arial/Helvetica, Times, Courier, Symbol, ZapfDingbats) — would otherwise
render with blank or `.notdef` glyphs. To avoid that, the viewer downloads a
substitute font on demand from Google Fonts and registers it with the engine.

This document describes how that mechanism works and, precisely, **which font is
used for what**. The code lives in
[`packages/viewer/src/font-fallback.ts`](../packages/viewer/src/font-fallback.ts)
(the resolver logic) and
[`packages/viewer/src/font-tables.ts`](../packages/viewer/src/font-tables.ts)
(the vendored weight tables — a bulk data file listing each downloadable TTF by
its `fonts.gstatic.com` hash).

This mechanism supplies fonts to PDFium. FreeText script selection and emoji
image fallback use the shared engine text-appearance pipeline described in
[TEXT-APPEARANCE.md](TEXT-APPEARANCE.md); emoji assets are deliberately not
treated as missing PDF fonts.

## How it works

1. **Discovery.** When the engine opens or renders a document and cannot satisfy
   a font, it emits a `missingFonts` event carrying one `PdfFontQuery` per
   unresolved font. A query ([`PdfFontQuery`]) describes the requested face by
   name plus the Windows font attributes PDFium exposes: `weight`, `isItalic`,
   `charset` (Windows charset id), and `pitchFamily` (pitch flags plus a family
   value such as Roman, Swiss, or Modern).

2. **Resolution.** The viewer normalizes the requested family name (removing
   subset, style, and CMap suffixes) and classifies it as serif, sans-serif, or
   monospace. Known CJK and Latin family names take precedence over PDFium's
   often incomplete `pitchFamily` hint. The viewer then feeds each query to a
   [`FontResolver`]. The default is [`googleFontsResolver`]. It returns a
   [`FontResolution`] — the substitute file's URL, the family name the file
   declares, and its expected byte length — or `null` to leave the font
   unresolved (e.g. Symbol fonts).

3. **Download.** The viewer fetches the TTF from
   `https://fonts.gstatic.com/s/a/<hash>.ttf`, which serves
   `access-control-allow-origin: *` so the cross-origin fetch succeeds. Downloads
   are de-duplicated: several queries resolving to the same file fetch once.

4. **Registration & reload.** The bytes are registered against the requested
   face via `engine.addFontData(...)`, then `engine.reloadFonts()` runs. Because
   the engine caches substituted fonts per document, the document is reopened
   (preserving view state) so the newly registered fonts take effect.

5. **Persistence.** The worker persists registered fonts in IndexedDB
   (`pdfrx.fonts`), so subsequent sessions resolve the same fonts instantly
   without re-downloading.

The orchestration (dedup, download cache, batch serialization, document reopen)
is in [`PdfrxViewer`] — see the "Missing-font fallback" section of
[`viewer.ts`](../packages/viewer/src/viewer.ts).

## What font is used for what

The resolver tries two strategies in order.

### 1. Standard / Core fonts → metric-compatible substitutes

Applied **only** when `charset` is ANSI (0) or DEFAULT (1). These three families
are chosen because they are metric-compatible with the standard PDF fonts —
i.e. the glyphs occupy the same advance widths, so line breaks and layout stay
faithful even though the outlines differ.

| Requested face contains (case-insensitive) — or fixed pitch | Substitute | Metric-compatible with |
|---|---|---|
| `courier`, `mono`, `consolas`, `menlo`, `monaco`, or fixed-pitch flag | [**Cousine**] | Courier (monospace) |
| `arial`, `helvetica`, `sans`, `verdana`, `tahoma` | [**Arimo**] | Arial / Helvetica |
| `times`, `serif`, `georgia`, `garamond`, `minion` | [**Tinos**] | Times New Roman |

Each has upright and italic weight tables; italic is chosen when the query is
italic or the face name contains `italic`/`oblique`.

### 2. Everything else → a Noto family by charset

When no metric-compatible match applies, the resolver picks a Noto family from
the query's `charset`. Whether the **serif** or **sans** variant is used is
determined in this order:

1. A normalized known-family table and established CJK naming conventions.
2. Explicit family terms in the name (`sans`, `serif`, `mono`, and so on).
3. PDFium's `pitchFamily` family nibble.
4. Sans-serif when the family remains unknown.

The built-in CJK classification covers common platform and PDF families,
including Song/Ming/Mincho/Batang as serif and Hei/Gothic/Dotum/Gulim as
sans-serif. It also includes aliases such as STSong, SimSun, Microsoft YaHei,
PingFang, MingLiU, MS Mincho/Gothic, Yu Mincho/Gothic, Hiragino, Meiryo,
Batang, Malgun Gothic, and the Source Han/Noto CJK families. This table only
classifies style; `charset` still selects SC, TC, JP, or KR glyph coverage.

| Charset (Windows id) | Sans variant | Serif variant |
|---|---|---|
| ANSI (0) / DEFAULT (1) — Latin | [Noto Sans] | [Noto Serif] |
| Greek (161), Vietnamese (163), Cyrillic (204), Eastern European (238) | [Noto Sans] | [Noto Serif] |
| ShiftJIS (128) — Japanese | [Noto Sans JP] | [Noto Serif JP] |
| Hangul (129) — Korean | [Noto Sans KR] | [Noto Serif KR] |
| GB2312 (134) — Simplified Chinese | [Noto Sans SC] | [Noto Serif SC] |
| Big5 (136) — Traditional Chinese | [Noto Sans TC] | [Noto Serif TC] |
| Thai (222) | [Noto Sans Thai] | [Noto Serif Thai] |
| Hebrew (177) | [Noto Sans Hebrew] | [Noto Serif Hebrew] |
| Arabic (178) | [Noto Sans Arabic] | [Noto Naskh Arabic] (serif) |
| Symbol (2) | — (unresolved) | — (unresolved) |

Notes:

- A recognized family name overrides a contradictory `pitchFamily` value.
  This is intentional: generated PDFs frequently provide a generic or
  incorrect LOGFONT family hint.
- The high nibble of `pitchFamily` is a mutually exclusive LOGFONT family
  value, not a set of independent flags. In particular, Modern (`0x30`) is
  monospace and is not Roman merely because both values contain bit `0x10`.
- The large Noto CJK OTC collections are intentionally **not** used: they are
  only hosted on GitHub raw, which has no CORS. The per-language `Noto Sans/Serif
  SC/TC/JP/KR` subsets on `fonts.gstatic.com` are used instead.

### Weight selection

Within the chosen family, the resolver picks the **nearest available weight** to
the query's weight. If the query has no numeric weight (100–900), it is inferred
from style words in the face name (`black`/`heavy` → 900, `bold` → 700,
`light` → 300, `thin` → 100, etc.), defaulting to 400.

## Customizing or disabling

The resolver is pluggable via the [`fontResolver`][PdfrxViewerOptions] viewer
option:

- **Default** — omit the option; `googleFontsResolver` is used.
- **Disable entirely** — pass `fontResolver: null`. Missing fonts stay
  unresolved (nothing is downloaded).
- **Custom** — pass your own [`FontResolver`], e.g. to serve substitutes from
  your own origin or to add coverage for scripts not handled above.

[`googleFontsResolver`], [`FontResolver`], and [`FontResolution`] are re-exported
from `@pdfrx/viewer` (see [`index.ts`](../packages/viewer/src/index.ts)).

## Licensing

The substitute fonts are downloaded at runtime from Google Fonts and are not
redistributed by this project. Arimo, Tinos, Cousine, and the Noto families are
licensed under the [SIL Open Font License](https://openfontlicense.org/open-font-license-official-text/). The vendored `font-tables.ts` contains
only hashes and metadata, not font outlines.

<!-- API reference links (generated by TypeDoc; published at the docs site root) -->
[`PdfFontQuery`]: https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_engine.PdfFontQuery.html
[`FontResolver`]: https://espresso3389.github.io/pdfrx_web/types/_pdfrx_viewer.FontResolver.html
[`FontResolution`]: https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.FontResolution.html
[`googleFontsResolver`]: https://espresso3389.github.io/pdfrx_web/variables/_pdfrx_viewer.googleFontsResolver.html
[`PdfrxViewer`]: https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_viewer.PdfrxViewer.html
[PdfrxViewerOptions]: https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer.PdfrxViewerOptions.html

<!-- Google Fonts specimen pages -->
[**Cousine**]: https://fonts.google.com/specimen/Cousine
[**Arimo**]: https://fonts.google.com/specimen/Arimo
[**Tinos**]: https://fonts.google.com/specimen/Tinos
[Noto Sans]: https://fonts.google.com/noto/specimen/Noto+Sans
[Noto Serif]: https://fonts.google.com/noto/specimen/Noto+Serif
[Noto Sans JP]: https://fonts.google.com/noto/specimen/Noto+Sans+JP
[Noto Serif JP]: https://fonts.google.com/noto/specimen/Noto+Serif+JP
[Noto Sans KR]: https://fonts.google.com/noto/specimen/Noto+Sans+KR
[Noto Serif KR]: https://fonts.google.com/noto/specimen/Noto+Serif+KR
[Noto Sans SC]: https://fonts.google.com/noto/specimen/Noto+Sans+SC
[Noto Serif SC]: https://fonts.google.com/noto/specimen/Noto+Serif+SC
[Noto Sans TC]: https://fonts.google.com/noto/specimen/Noto+Sans+TC
[Noto Serif TC]: https://fonts.google.com/noto/specimen/Noto+Serif+TC
[Noto Sans Thai]: https://fonts.google.com/noto/specimen/Noto+Sans+Thai
[Noto Serif Thai]: https://fonts.google.com/noto/specimen/Noto+Serif+Thai
[Noto Sans Hebrew]: https://fonts.google.com/noto/specimen/Noto+Sans+Hebrew
[Noto Serif Hebrew]: https://fonts.google.com/noto/specimen/Noto+Serif+Hebrew
[Noto Sans Arabic]: https://fonts.google.com/noto/specimen/Noto+Sans+Arabic
[Noto Naskh Arabic]: https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic
