import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { pdfiumAssets } from '../basic/vite-pdfium-assets';
import { pdfrxSrcAliases } from '../basic/vite-pdfrx-src';
import { startPageRelayServer, type RunningPageRelayServer } from './src/relay-server.js';

const relayPort = 5191;

const collaborationRelay = (): Plugin => {
  let relay: RunningPageRelayServer | null = null;
  return {
    name: 'collaboration-relay',
    async configureServer(server) {
      relay = await startPageRelayServer({
        port: relayPort,
        sessions: {
          demo: {
            revision: 0,
            pages: [0, 1, 2].map((pageIndex) => ({
              placementId: `page-${pageIndex + 1}`,
              source: { documentId: 'main', pageIndex },
              rotation: 0,
            })),
          },
        },
      });
      server.httpServer?.once('close', () => void relay?.close());
    },
  };
};

export default defineConfig(({ command, mode }) => ({
  base: './',
  publicDir: resolve(import.meta.dirname, '../react/public'),
  resolve: { alias: pdfrxSrcAliases },
  plugins: [
    react(),
    pdfiumAssets(),
    ...(command === 'serve' && mode !== 'test' ? [collaborationRelay()] : []),
  ],
  server: { host: true, port: 5173, strictPort: true },
}));
