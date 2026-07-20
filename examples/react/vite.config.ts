import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pdfiumAssets } from '../basic/vite-pdfium-assets';
import { pdfrxSrcAliases } from '../basic/vite-pdfrx-src';

export default defineConfig({
  // Relative base so the build works when hosted under a sub-path
  // (e.g. GitHub Pages at /pdfrx_web/demo-react/).
  base: './',
  // Resolve @pdfrx/* to source, so the example needs no pre-build and never
  // reads a half-rebuilt dist/ (see vite-pdfrx-src.ts).
  resolve: { alias: pdfrxSrcAliases },
  plugins: [react(), pdfiumAssets()],
  server: {
    // See the note in examples/basic/vite.config.ts: listening on every
    // interface is what makes it possible to test touch behaviour on a real
    // phone over Tailscale.
    host: true,
    allowedHosts: ['.ts.net'],
  },
});
