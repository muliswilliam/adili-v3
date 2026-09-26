import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres. The default points at local infra (`pnpm infra:up`); CI overrides it.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
    },
  },
});
