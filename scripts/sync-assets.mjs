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
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePdfrxRepo } from './pdfrx-repo.mjs';

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
