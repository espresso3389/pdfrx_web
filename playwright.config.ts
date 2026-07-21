import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 640, height: 480 },
  },
  webServer: {
    command: 'npm run dev --workspace=@pdfrx/example-basic -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/visual-tests/annotation-rendering.html',
    reuseExistingServer: !process.env.CI,
  },
});
