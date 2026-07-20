import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pdfiumAssets } from '../basic/vite-pdfium-assets';

export default defineConfig({
  // Relative base so the build works when hosted under a sub-path
  // (e.g. GitHub Pages at /pdfrx_web/demo-react/).
  base: './',
  plugins: [react(), pdfiumAssets()],
  server: {
    // See the note in examples/basic/vite.config.ts: listening on every
    // interface is what makes it possible to test touch behaviour on a real
    // phone over Tailscale.
    host: true,
    allowedHosts: ['.ts.net'],
  },
});
