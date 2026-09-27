import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Temporal. Defaults point at local infra (`pnpm infra:up`); CI overrides them.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    // Workers bundle the workflows when they start.
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: {
      TEST_TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEST_TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE ?? 'adili',
    },
  },
});
