import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The store touches DOM types and the components render, so jsdom rather
    // than node. Real canvas/WASM rendering is not exercised here — that is what
    // examples/react is for.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
