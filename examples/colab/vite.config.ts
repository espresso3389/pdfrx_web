import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { pdfiumAssets } from '../basic/vite-pdfium-assets';
import { pdfrxSrcAliases } from '../basic/vite-pdfrx-src';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.PDFRX_PUBLIC_BASE ?? './',
    publicDir: resolve(import.meta.dirname, 'public'),
    resolve: { alias: pdfrxSrcAliases },
    plugins: [react(), pdfiumAssets()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: ['.ts.net'],
      proxy: {
        '/api': 'http://127.0.0.1:5191',
        '/relay': { target: 'ws://127.0.0.1:5191', ws: true },
      },
    },
  };
});
