import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Valkey. The default points at local infra (`pnpm infra:up`); CI overrides it.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    env: {
      TEST_VALKEY_URL: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
    },
  },
});
