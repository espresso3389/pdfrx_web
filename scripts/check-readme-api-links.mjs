import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docsRoot = resolve(root, 'docs-site');
const publicPrefix = 'https://espresso3389.github.io/pdfrx_web/';
const symbolKinds = new Set(['classes', 'interfaces', 'types', 'functions', 'variables', 'enums']);
const packageModules = new Map([
  ['README.md', null],
  ['packages/engine/README.md', '_pdfrx_engine'],
  ['packages/viewer-core/README.md', '_pdfrx_viewer-core'],
  ['packages/viewer/README.md', '_pdfrx_viewer'],
  ['packages/react/README.md', '_pdfrx_react'],
  ['packages/colab/README.md', '_pdfrx_colab'],
]);

if (!existsSync(docsRoot)) {
  console.error('docs-site/ is missing; run npm run docs first.');
  process.exit(1);
}

const bySymbol = new Map();
for (const kind of symbolKinds) {
  const directory = resolve(docsRoot, kind);
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory)) {
    const match = /^(_pdfrx_[^.]+)\.(.+)\.html$/.exec(entry);
    if (!match) continue;
    const [, moduleName, symbol] = match;
    const candidates = bySymbol.get(symbol) ?? [];
    candidates.push({ moduleName, path: `${kind}/${entry}` });
    bySymbol.set(symbol, candidates);
  }
}

const missingTargets = [];
const unlinkedSymbols = [];
for (const [readme, preferredModule] of packageModules) {
  const absolute = resolve(root, readme);
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const match of line.matchAll(/https:\/\/espresso3389\.github\.io\/pdfrx_web\/((?:classes|interfaces|types|functions|variables|enums)\/[^\s)#]+)(?:#([A-Za-z0-9._:-]+))?/g)) {
      const [, localPath, fragment] = match;
      const localTarget = resolve(docsRoot, localPath.split('/').join(sep));
      if (!existsSync(localTarget)) {
        missingTargets.push(`${readme}:${index + 1}: ${match[0]}`);
      } else if (fragment && !readFileSync(localTarget, 'utf8').includes(`id="${fragment}"`)) {
        missingTargets.push(`${readme}:${index + 1}: ${match[0]} (missing local anchor #${fragment})`);
      }
    }

    const withoutLinks = line.replace(/\[[^\]]*]\([^)]*\)/g, '');
    for (const match of withoutLinks.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)(?:\(\))?`/g)) {
      const symbol = match[1];
      const candidates = bySymbol.get(symbol);
      if (!candidates) continue;
      const candidate = candidates.find((item) => item.moduleName === preferredModule)
        ?? (candidates.length === 1 ? candidates[0] : null);
      if (candidate) {
        unlinkedSymbols.push(
          `${readme}:${index + 1}: \`${match[0]}\` should link to ${publicPrefix}${candidate.path}`,
        );
      }
    }
  }
}

if (missingTargets.length || unlinkedSymbols.length) {
  if (missingTargets.length) {
    console.error('API links without a generated docs-site target:');
    for (const item of missingTargets) console.error(`  ${item}`);
  }
  if (unlinkedSymbols.length) {
    console.error('Public API symbols introduced without a direct TypeDoc link:');
    for (const item of unlinkedSymbols) console.error(`  ${item}`);
  }
  process.exit(1);
}

console.log(`README API links are complete and resolve into ${relative(root, docsRoot)}/.`);
