import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres, SeaweedFS (S3, with SSE-S3 configured and the ADR-002 buckets) and ClamAV.
// Defaults point at local infra (`pnpm infra:up`); CI overrides them.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
      TEST_S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8333',
      TEST_CLAMAV_HOST: process.env.TEST_CLAMAV_HOST ?? 'localhost',
      TEST_CLAMAV_PORT: process.env.TEST_CLAMAV_PORT ?? '3310',
    },
  },
});
