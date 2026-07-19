import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const engineAssets = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/engine/assets');

/**
 * Serves the vendored pdfium engine assets from @pdfrx/engine under /pdfium/.
 * In dev the files are streamed on the fly; for the production build they are
 * emitted into the bundle as `pdfium/pdfium_worker.js` and `pdfium/pdfium.wasm`
 * so the demo is self-contained (used for the GitHub Pages demo).
 */
function pdfiumAssets(): Plugin {
  const files = ['pdfium_worker.js', 'pdfium.wasm'];
  return {
    name: 'pdfium-assets',
    configureServer(server) {
      server.middlewares.use('/pdfium', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (!name || name.includes('..')) return next();
        const file = join(engineAssets, name);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({ type: 'asset', fileName: `pdfium/${name}`, source: readFileSync(join(engineAssets, name)) });
      }
    },
  };
}

export default defineConfig({
  // Relative base so the build works when hosted under a sub-path
  // (e.g. GitHub Pages at /pdfrx_web/demo/).
  base: './',
  plugins: [pdfiumAssets()],
  server: {
    // Allow access via Tailscale MagicDNS hostnames (e.g. <machine>.<tailnet>.ts.net)
    allowedHosts: ['.ts.net'],
  },
});
