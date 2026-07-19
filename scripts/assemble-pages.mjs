// Assembles the GitHub Pages site: the TypeDoc output in docs-site/ plus the
// built example app copied into docs-site/demo/.
//
// Run after `typedoc` and the example's `vite build`. Used by `npm run
// build:pages` and the docs workflow.

import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsSite = join(repoRoot, 'docs-site');
const demoDist = join(repoRoot, 'examples', 'basic', 'dist');
const demoOut = join(docsSite, 'demo');

if (!existsSync(docsSite)) {
  console.error(`docs-site/ not found — run \`npm run docs\` (typedoc) first.`);
  process.exit(1);
}
if (!existsSync(demoDist)) {
  console.error(`example build not found at ${demoDist} — run the example's \`vite build\` first.`);
  process.exit(1);
}

rmSync(demoOut, { recursive: true, force: true });
cpSync(demoDist, demoOut, { recursive: true });
console.log(`Assembled Pages site: TypeDoc docs + demo/ (from ${demoDist})`);
