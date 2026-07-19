// Locates the pdfrx repository used as the single source of truth by the
// maintainer scripts (sync-assets.mjs, gen-font-tables.mjs).
//
// Resolution order:
// 1. explicit CLI argument
// 2. PDFRX_REPO environment variable
// 3. the external/pdfrx git submodule (run `git submodule update --init`)
// 4. a ../pdfrx sibling checkout

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function resolvePdfrxRepo(repoRoot, cliArg) {
  if (cliArg) return resolve(cliArg);
  if (process.env.PDFRX_REPO) return resolve(process.env.PDFRX_REPO);
  const submodule = join(repoRoot, 'external', 'pdfrx');
  if (existsSync(join(submodule, 'packages'))) return submodule;
  return resolve(repoRoot, '..', 'pdfrx');
}
