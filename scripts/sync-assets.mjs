// Syncs the pdfium WASM engine assets from the pdfrx repository.
// The source of truth for pdfium_worker.js / pdfium.wasm stays in pdfrx;
// this repo only consumes them.
//
// Usage: node scripts/sync-assets.mjs [path-to-pdfrx-repo]
//        (default: ../pdfrx relative to this repo, or PDFRX_REPO env var)

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pdfrxRepo = resolve(process.argv[2] ?? process.env.PDFRX_REPO ?? join(repoRoot, '..', 'pdfrx'));
const srcAssets = join(pdfrxRepo, 'packages', 'pdfrx', 'assets');

if (!existsSync(join(srcAssets, 'pdfium_worker.js'))) {
  console.error(`pdfium assets not found under ${srcAssets}`);
  console.error('Pass the pdfrx repo path as an argument or set PDFRX_REPO.');
  process.exit(1);
}

const targets = [
  {
    dir: join(repoRoot, 'packages', 'engine', 'assets'),
    files: ['pdfium_worker.js', 'pdfium.wasm'],
  },
  {
    dir: join(repoRoot, 'examples', 'basic', 'public', 'pdfium'),
    files: ['pdfium_worker.js', 'pdfium.wasm'],
  },
];

for (const { dir, files } of targets) {
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    copyFileSync(join(srcAssets, file), join(dir, file));
    console.log(`${join(srcAssets, file)} -> ${join(dir, file)}`);
  }
}

// Sample PDF for the example app
const samplePdf = join(pdfrxRepo, 'packages', 'pdfrx', 'example', 'viewer', 'assets', 'hello.pdf');
if (existsSync(samplePdf)) {
  const dest = join(repoRoot, 'examples', 'basic', 'public', 'hello.pdf');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(samplePdf, dest);
  console.log(`${samplePdf} -> ${dest}`);
}
