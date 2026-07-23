# AGENTS.md

Guidance for coding agents working in this repo. Keep it current when the build,
release, or package layout changes.

## What this repo is

`pdfrx_web` — a canvas-based PDF viewer for the browser, published as five npm
packages from one workspace. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the layering, the worker protocol, and coordinate conventions; don't
duplicate that here.

| Package | Role |
|---|---|
| `@pdfrx/engine` | Typed client for the WASM rendering worker. |
| `@pdfrx/viewer-core` | DOM-free geometry / layout / selection logic. |
| `@pdfrx/viewer` | The `<canvas>` viewer shell + `<pdfrx-viewer>` element. |
| `@pdfrx/react` | React components and hooks over `@pdfrx/viewer`. |
| `@pdfrx/colab` | Collaborative React viewer and browser session client. |

Dependency order (build and publish must respect it):
`engine → viewer-core → viewer → react → colab`.

Examples live in `examples/basic` (vanilla), `examples/react`, and
`examples/colab`. They are private (`"private": true`) and never published.

The deployable single-viewer collaboration app, persistent Bun relay, and
reference test relay live in `examples/colab`. They are private and
non-published; the reusable browser client, protocol, adapter, export composer,
and React component live in the published `@pdfrx/colab` package.

## Commands

```sh
npm install
npm run build        # tsc: five published packages + colab example
npm test             # vitest: viewer-core + react + colab + colab example
npm run test:visual  # Playwright: PDFium vs SVG annotation pixel diffs
npm run dev          # examples/basic  (http://localhost:5173)
npm run dev:react    # examples/react  (http://localhost:5173)
npm run dev:colab    # single-viewer collaboration app + Bun relay
npm run docs         # typedoc -> docs-site/
npm run build:pages  # build + docs + static Pages-compatible examples + assemble
```

### Development-server safety

Use only the repository's `npm run dev*` scripts to start verification servers.
Do not invoke Vite directly, start `relay-server.ts` independently, or assemble
an ad-hoc replacement server: those bypass the workspace's asset, alias, and
relay lifecycle configuration and can interfere with the developer's existing
environment.

Before starting a server, check whether its configured HTTP and auxiliary ports
are already listening. If the expected app is already running, reuse it and
reload the browser instead of starting another instance. If the occupant cannot
be identified as the expected app, report the conflict; do not kill it or move
to another port without the user's direction. Likewise, stop only a process
started by the current task—never terminate a pre-existing development server.

All Vite configs set a fixed port with `strictPort: true`. This is intentional:
an `npm run dev*` command must fail visibly on a conflict instead of silently
starting on 5174 (or another port) and leaving multiple servers behind. The
colab script also owns its Bun relay on port 5191; do not start a
second relay separately.

Per-package: `npm run build --workspace=@pdfrx/<name>` and
`npm run typecheck --workspace=@pdfrx/<name>`.

Before finishing any change, run `npm run build` and `npm test`. If you touched
a viewer-visible behavior, verify it in `npm run dev:react` (or `dev`) with the
browser tools — don't ask the user to check manually.

Annotation rendering changes should also run `npm run test:visual`. Install its
browser once with `npx playwright install chromium`; failures attach the PDFium,
SVG, and diff PNGs to the Playwright report.

The examples resolve `@pdfrx/*` to each package's `src/` via a Vite alias
([examples/basic/vite-pdfrx-src.ts](examples/basic/vite-pdfrx-src.ts)), so
`npm run dev`/`dev:react` need no prior package build and pick up source edits
via HMR. (Before this, Vite served each package's `dist/`, and rebuilding a
package under a live dev server let HMR read a half-written `dist/*.js` and
throw `does not provide an export named …`.) Editing a package's source alone is
enough for the examples; a full `npm run build` is still what CI and publishing
use.

### README and API-reference links

Package READMEs should link public classes, interfaces, types, functions, and
components to their specific TypeDoc pages wherever those APIs are introduced
in prose or API tables. A module-level API-reference link is useful, but it is
not a substitute for direct symbol links. Code fences do not need embedded
links.

Do this link pass whenever public exports are added, renamed, or substantially
documented, whenever a package README is expanded, and again during release
preparation. Run `npm run docs` first and derive links from the files actually
generated under `docs-site/{classes,interfaces,types,functions,...}`; do not
guess TypeDoc filenames or anchors. Before finishing, mechanically verify that
every `https://espresso3389.github.io/pdfrx_web/...` API link in the changed
README maps to a generated local path. `docs-site/` remains ignored build
output and must not be committed.

For a new or renamed public API, use a two-stage update so the README never
points at a symbol that has not reached the public API reference yet:

1. Add the export and its TypeDoc comments, run the normal build/tests and
   `npm run docs`, then commit and push that API change.
2. Wait for the `Docs` GitHub Actions workflow triggered by that push to
   succeed, and verify the symbol's final URL on the deployed API reference.
3. Add or update the package README using that verified public URL, validate
   the links against the local `docs-site/` output, then commit and push the
   README change separately.
4. Do not create the release tag until both pushes are complete and the README
   links resolve publicly.

Existing, already-deployed symbols do not require an artificial preliminary
commit; link them directly and include the README update in the current docs
change.

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
added to CI once the trusted publisher exists. (`@pdfrx/react` 0.2.2 was
published this way; from 0.3.0 its trusted publisher is set up. `@pdfrx/colab`
0.9.0 follows the same manual-first-release process.)

**All five packages share one version, and it must equal the tag.** The workflow
refuses to publish if any `packages/*/package.json` version disagrees with the
tag (`v0.2.1` → every package must be `0.2.1`). To cut a release:

1. Bump `version` in **all five** `packages/*/package.json` to the new number.
2. Bump the hard-coded CDN version strings (see the checklist below) to match.
3. Add a `## [X.Y.Z]` section (with today's date) to [CHANGELOG.md](CHANGELOG.md)
   summarizing the release, and add its `compare` link at the bottom. Derive the
   entries from the commits since the last tag
   (`git log --oneline vPREV..HEAD`).
4. Commit, then tag `vX.Y.Z` and push the tag. The workflow verifies and
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
which lacks those methods, and crash at runtime.) When unsure, keep all five
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
