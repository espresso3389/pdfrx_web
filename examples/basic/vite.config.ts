import { createReadStream, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const engineAssets = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/engine/assets');

/**
 * Serves the vendored pdfium engine assets from @pdfrx/engine under /pdfium/
 * so the example does not need its own copy of pdfium.wasm.
 */
function servePdfiumAssets(): Plugin {
  return {
    name: 'serve-pdfium-assets',
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
  };
}

export default defineConfig({
  plugins: [servePdfiumAssets()],
  server: {
    // Allow access via Tailscale MagicDNS hostnames (e.g. <machine>.<tailnet>.ts.net)
    allowedHosts: ['.ts.net'],
  },
});
