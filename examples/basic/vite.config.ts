import { defineConfig } from 'vite';
import { pdfiumAssets } from './vite-pdfium-assets';

export default defineConfig({
  // Relative base so the build works when hosted under a sub-path
  // (e.g. GitHub Pages at /pdfrx_web/demo/).
  base: './',
  plugins: [pdfiumAssets()],
  server: {
    // Listen on every interface, not just loopback, so the example can be
    // opened on a phone over Tailscale — testing touch behaviour needs a real
    // device. Without this `npm run dev` binds to localhost, the request never
    // arrives, and allowedHosts below is never even consulted.
    // Note that this exposes the dev server on every network the machine is
    // on, not only the tailnet.
    host: true,
    // Accept the Host header of Tailscale MagicDNS names
    // (e.g. <machine>.<tailnet>.ts.net); vite otherwise rejects them.
    allowedHosts: ['.ts.net'],
  },
});
