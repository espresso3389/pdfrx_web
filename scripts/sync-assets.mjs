// Updates the vendored pdfium WASM engine assets from a pdfrx checkout.
//
// The assets (pdfium_worker.js / pdfium.wasm) are committed to this repo so
// it builds standalone; this script is a maintainer tool for pulling in a
// newer version from the pdfrx repository. It records the source commit in
// packages/engine/assets/UPSTREAM.md.
//
// Usage: node scripts/sync-assets.mjs [path-to-pdfrx-repo]
//        (default: the external/pdfrx submodule; run
//         `git submodule update --init` first)

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePdfrxRepo } from './pdfrx-repo.mjs';

// The upstream worker renders in pdfium's native BGRA order (Flutter/Skia
// consumes BGRA directly). On the web every consumer wants RGBA, so we rewrite
// the bitmap copy-out to emit RGBA — folding the B<->R swap into the copy that
// already happens there makes it effectively free. This patch is reapplied on
// every sync so the vendored worker stays RGBA even after pulling a new upstream
// version; keep it in lockstep with the same block in packages/engine/assets.
const RGBA_PATCH_MARKER = '[pdfrx_web: RGBA output patch';
const RGBA_PATCH_FROM = `    const src = new Uint8Array(Pdfium.memory.buffer, bufferPtr, bufferSize);
    let copiedBuffer = new ArrayBuffer(bufferSize);
    let dest = new Uint8Array(copiedBuffer);
    if (flags & premultipliedAlpha) {
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        dest[i] = (src[i] * a + 128) >> 8;
        dest[i + 1] = (src[i + 1] * a + 128) >> 8;
        dest[i + 2] = (src[i + 2] * a + 128) >> 8;
        dest[i + 3] = a;
      }
    } else {
      dest.set(src);
    }`;
const RGBA_PATCH_TO = `    // pdfium renders BGRA; emit RGBA so the result is directly Canvas/WebGL-ready
    // on the web (no web consumer wants BGRA). The B<->R swap is folded into the
    // copy that happens here anyway, so it is effectively free.
    // ${RGBA_PATCH_MARKER} — reapplied by scripts/sync-assets.mjs]
    const src = new Uint8Array(Pdfium.memory.buffer, bufferPtr, bufferSize);
    let copiedBuffer = new ArrayBuffer(bufferSize);
    let dest = new Uint8Array(copiedBuffer);
    if (flags & premultipliedAlpha) {
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        dest[i] = (src[i + 2] * a + 128) >> 8;
        dest[i + 1] = (src[i + 1] * a + 128) >> 8;
        dest[i + 2] = (src[i] * a + 128) >> 8;
        dest[i + 3] = a;
      }
    } else {
      for (let i = 0; i < src.length; i += 4) {
        dest[i] = src[i + 2];
        dest[i + 1] = src[i + 1];
        dest[i + 2] = src[i];
        dest[i + 3] = src[i + 3];
      }
    }`;

function patchWorkerToRgba(workerPath) {
  const raw = readFileSync(workerPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  // Match/replace on LF-normalized text so the patch is line-ending agnostic
  // (the upstream worker ships CRLF on Windows checkouts), then restore EOL.
  const source = raw.split('\r\n').join('\n');
  if (source.includes(RGBA_PATCH_MARKER)) {
    console.log('pdfium_worker.js already emits RGBA (patch present)');
    return;
  }
  if (!source.includes(RGBA_PATCH_FROM)) {
    console.error(
      'sync-assets: could not find the expected BGRA bitmap copy-out block in\n' +
        `  ${workerPath}\n` +
        'The upstream worker changed; update RGBA_PATCH_FROM/TO in scripts/sync-assets.mjs\n' +
        'so the vendored worker keeps emitting RGBA (see packages/engine/src/types.ts PdfImage).',
    );
    process.exit(1);
  }
  const patched = source.replace(RGBA_PATCH_FROM, RGBA_PATCH_TO).split('\n').join(eol);
  writeFileSync(workerPath, patched);
  console.log('Patched pdfium_worker.js to emit RGBA instead of BGRA');
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pdfrxRepo = resolvePdfrxRepo(repoRoot, process.argv[2]);
const srcAssets = join(pdfrxRepo, 'packages', 'pdfrx', 'assets');

if (!existsSync(join(srcAssets, 'pdfium_worker.js'))) {
  console.error(`pdfium assets not found under ${srcAssets}`);
  console.error('Run `git submodule update --init`, or pass a pdfrx repo path / set PDFRX_REPO.');
  process.exit(1);
}

const assetsDir = join(repoRoot, 'packages', 'engine', 'assets');
mkdirSync(assetsDir, { recursive: true });
for (const file of ['pdfium_worker.js', 'pdfium.wasm']) {
  copyFileSync(join(srcAssets, file), join(assetsDir, file));
  console.log(`${join(srcAssets, file)} -> ${join(assetsDir, file)}`);
}

// Web-only: make the worker emit RGBA instead of pdfium's native BGRA.
patchWorkerToRgba(join(assetsDir, 'pdfium_worker.js'));

// Record where the assets came from.
let commit = '(unknown)';
try {
  commit = execFileSync('git', ['-C', pdfrxRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
writeFileSync(
  join(assetsDir, 'UPSTREAM.md'),
  `# Vendored pdfium WASM engine assets

- Source: https://github.com/espresso3389/pdfrx (\`packages/pdfrx/assets\`)
- Commit: \`${commit}\`

\`pdfium_worker.js\` and \`pdfium.wasm\` are developed in the pdfrx repository;
do not edit them here. To update, run \`node scripts/sync-assets.mjs <pdfrx-checkout>\`.

Note: \`sync-assets.mjs\` applies one web-only patch to \`pdfium_worker.js\` after
copying — it rewrites the render bitmap copy-out to emit **RGBA** instead of
pdfium's native **BGRA** (see \`RGBA_PATCH_*\` in that script). RGBA is the only
format the web can consume directly; the swap is folded into the existing copy,
so it costs nothing. Upstream (Flutter/Skia) stays BGRA on purpose.
`,
);
console.log(`Recorded upstream commit ${commit}`);

// Sample PDF for the example app
const samplePdf = join(pdfrxRepo, 'packages', 'pdfrx', 'example', 'viewer', 'assets', 'hello.pdf');
if (existsSync(samplePdf)) {
  const dest = join(repoRoot, 'examples', 'basic', 'public', 'hello.pdf');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(samplePdf, dest);
  console.log(`${samplePdf} -> ${dest}`);
}
