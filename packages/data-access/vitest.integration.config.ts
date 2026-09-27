import { defineConfig } from 'vitest/config';

// Needs OpenBao. Defaults point at local infra (`pnpm infra:up`); CI overrides them.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    env: {
      TEST_OPENBAO_URL: process.env.TEST_OPENBAO_URL ?? 'http://localhost:8200',
      TEST_OPENBAO_TOKEN: process.env.TEST_OPENBAO_TOKEN ?? 'adili-dev-root-token',
    },
  },
});
