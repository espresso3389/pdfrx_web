import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Allow access via Tailscale MagicDNS hostnames (e.g. <machine>.<tailnet>.ts.net)
    allowedHosts: ['.ts.net'],
  },
});
