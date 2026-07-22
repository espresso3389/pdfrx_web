// Assembles the GitHub Pages site: the TypeDoc output in docs-site/ plus the
// built example apps copied in beside it.
//
// Run after `typedoc` and the examples' `vite build`. Used by `npm run
// build:pages` and the docs workflow.

import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsSite = join(repoRoot, 'docs-site');

/** Each example, and the path it is served from under the Pages site. */
const demos = [
  { example: 'basic', out: 'demo' },
  { example: 'react', out: 'demo-react' },
];

// The colab example owns a WebSocket relay and cannot run as a static Pages
// artifact. Remove output from older builds so it is not accidentally deployed.
rmSync(join(docsSite, 'demo-colab'), { recursive: true, force: true });

if (!existsSync(docsSite)) {
  console.error(`docs-site/ not found — run \`npm run docs\` (typedoc) first.`);
  process.exit(1);
}

for (const { example, out } of demos) {
  const dist = join(repoRoot, 'examples', example, 'dist');
  if (!existsSync(dist)) {
    console.error(`example build not found at ${dist} — run the example's \`vite build\` first.`);
    process.exit(1);
  }
  const target = join(docsSite, out);
  rmSync(target, { recursive: true, force: true });
  cpSync(dist, target, { recursive: true });
  console.log(`  ${out}/ <- ${dist}`);
}

console.log(`Assembled Pages site: TypeDoc docs + ${demos.map((d) => `${d.out}/`).join(', ')}`);
