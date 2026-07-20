# AGENTS.md

Guidance for coding agents working in this repo. Keep it current when the build,
release, or package layout changes.

## What this repo is

`pdfrx_web` — a canvas-based PDF viewer for the browser, published as four npm
packages from one workspace. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the layering, the worker protocol, and coordinate conventions; don't
duplicate that here.

| Package | Role |
|---|---|
| `@pdfrx/engine` | Typed client for the WASM rendering worker. |
| `@pdfrx/viewer-core` | DOM-free geometry / layout / selection logic. |
| `@pdfrx/viewer` | The `<canvas>` viewer shell + `<pdfrx-viewer>` element. |
| `@pdfrx/react` | React components and hooks over `@pdfrx/viewer`. |

Dependency order (build and publish must respect it):
`engine → viewer-core → viewer → react`.

Examples live in `examples/basic` (vanilla) and `examples/react`. Both are
private (`"private": true`) and never published.

## Commands

```sh
npm install
npm run build        # tsc for all four packages (no bundler)
npm test             # vitest: viewer-core + react
npm run dev          # examples/basic  (http://localhost:5173)
npm run dev:react    # examples/react  (http://localhost:5173)
npm run docs         # typedoc -> docs-site/
npm run build:pages  # build + docs + both example builds + assemble
```

Per-package: `npm run build --workspace=@pdfrx/<name>` and
`npm run typecheck --workspace=@pdfrx/<name>`.

Before finishing any change, run `npm run build` and `npm test`. If you touched
a viewer-visible behavior, verify it in `npm run dev:react` (or `dev`) with the
browser tools — don't ask the user to check manually.

The examples resolve `@pdfrx/*` to each package's `src/` via a Vite alias
([examples/basic/vite-pdfrx-src.ts](examples/basic/vite-pdfrx-src.ts)), so
`npm run dev`/`dev:react` need no prior package build and pick up source edits
via HMR. (Before this, Vite served each package's `dist/`, and rebuilding a
package under a live dev server let HMR read a half-written `dist/*.js` and
throw `does not provide an export named …`.) Editing a package's source alone is
enough for the examples; a full `npm run build` is still what CI and publishing
use.

## TypeScript conventions

Set in [tsconfig.base.json](tsconfig.base.json); the build will reject
violations, so match them from the start:

- **ESM with explicit extensions.** Intra-package imports end in `.js` even
  though the source is `.ts`/`.tsx` (e.g. `import { x } from './store.js'`).
- **`verbatimModuleSyntax`** — import types with `import type { T }` (or
  `import { type T }`); a value import of a type-only symbol fails to build.
- **`noUncheckedIndexedAccess`** — `arr[i]` is `T | undefined`; narrow it.
- **`strict`, `noImplicitOverride`, `forceConsistentCasingInFileNames`.**

## Releasing

Publishing is tag-driven and runs on GitHub Actions
([.github/workflows/release.yml](.github/workflows/release.yml)) via npm
**trusted publishing** (OIDC — no npm token in the repo). Each package must name
this workflow as its trusted publisher on npmjs.com; a brand-new package will
not publish until that is configured. **A package's first-ever version is
therefore published manually** (`npm publish --workspace=@pdfrx/<name>` with a
local npm login) with its automated publish step left out of release.yml, then
added to CI once the trusted publisher exists. (`@pdfrx/react` 0.2.2 was the
first such case.)

**All four packages share one version, and it must equal the tag.** The workflow
refuses to publish if any `packages/*/package.json` version disagrees with the
tag (`v0.2.1` → every package must be `0.2.1`). To cut a release:

1. Bump `version` in **all four** `packages/*/package.json` to the new number.
2. Bump the hard-coded CDN version strings (see the checklist below) to match.
3. Commit, then tag `vX.Y.Z` and push the tag. The workflow verifies and
   publishes in dependency order.

Pushing to `master` (no tag) does **not** publish; it only rebuilds and deploys
the docs site ([.github/workflows/docs.yml](.github/workflows/docs.yml)):
TypeDoc at the root, plus `demo/` (vanilla) and `demo-react/` (React).

## Easy-to-miss couplings (this is the anti-mistake checklist)

**Hard-coded version strings.** The engine's CDN asset URL embeds a version, and
it is written out in several READMEs. Grep before every release:

```sh
grep -rn '@pdfrx/engine@[0-9]' README.md packages/*/README.md
```

Today that URL appears in [README.md](README.md),
[packages/engine/README.md](packages/engine/README.md),
[packages/viewer/README.md](packages/viewer/README.md), and
[packages/react/README.md](packages/react/README.md). Keep them equal to the
package version. (These drift silently because nothing type-checks a string in a
markdown fence — that is exactly why this section exists.)

**Inter-package dependency ranges** in package.json use `^` (e.g.
`"@pdfrx/viewer": "^0.2.2"`). Raise a range's **minimum to the release version
whenever a package starts calling an API added to a sibling in that same
release** — even on a patch. (Concretely: `@pdfrx/react` calls
`viewer.addTransformChangeListener()` / `pageCount`, added in 0.2.2, so its dep
is `^0.2.2`, not `^0.2.0`. Left at `^0.2.0` a user could resolve `viewer@0.2.1`,
which lacks those methods, and crash at runtime.) When unsure, keep all four
ranges pinned to the current release version.

**Adding a new package** means touching every place that enumerates packages —
missing one produces a half-published or half-documented release:

- root [package.json](package.json): the `build` and `test` script workspace
  lists, and `build:pages`.
- [typedoc.json](typedoc.json): `entryPoints`.
- [.github/workflows/release.yml](.github/workflows/release.yml): the
  version-check `for pkg in …` loop **and** a matching `npm publish --workspace`
  step in dependency order.
- [scripts/assemble-pages.mjs](scripts/assemble-pages.mjs) if it ships a demo.
- the root [README.md](README.md) packages table.

**Adding a new example** means updating `build:pages` (the `--workspace` list),
`scripts/assemble-pages.mjs` (the `demos` array), and adding a `.claude/launch.json`
entry if you want the browser tools to run it.

**Vendored assets are committed, not fetched.** `packages/engine/assets/`
(`pdfium_worker.js`, `pdfium.wasm`) and `packages/viewer/src/font-tables.ts` are
checked in, so a plain clone builds and runs with no submodule or postinstall.
The example Vite configs serve the assets under `/pdfium/` via the shared
`examples/basic/vite-pdfium-assets.ts` plugin.

**`dist/` and `docs-site/` are git-ignored** build output — never commit them.
