import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Alias } from 'vite';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Resolves the `@pdfrx/*` packages to their TypeScript source instead of the
 * built `dist/`.
 *
 * The examples are inside the workspace, so without this Vite serves each
 * package's `dist/`, which only exists after `npm run build`. Worse, rebuilding
 * a package while the dev server is running lets HMR read a half-written
 * `dist/*.js` and throw `does not provide an export named …`. Pointing at the
 * source removes both problems: no pre-build step, and editing a package
 * hot-reloads the example immediately.
 *
 * The patterns are anchored with `$` so only the bare specifier is redirected —
 * subpaths like `@pdfrx/react/styles.css` still resolve through the workspace
 * symlink in `node_modules`.
 */
export const pdfrxSrcAliases: Alias[] = ['engine', 'viewer-core', 'viewer', 'react'].map((name) => ({
  find: new RegExp(`^@pdfrx/${name}$`),
  replacement: resolve(repoRoot, `packages/${name}/src/index.ts`),
}));
