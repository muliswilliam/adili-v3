import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits the decorator metadata Nest's dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    isolate: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
    // The first run downloads Temporal's test server and bundles the workflows.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
