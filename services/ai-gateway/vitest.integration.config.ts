import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres, RabbitMQ and Temporal. Defaults point at local infra (`pnpm infra:up`); CI
// overrides them.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    globalSetup: ['test/support/workflow-bundles.ts'],
    setupFiles: ['test/support/integration-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
      ...(process.env.TEST_RABBITMQ_URL && { RABBITMQ_URL: process.env.TEST_RABBITMQ_URL }),
      ...(process.env.TEST_TEMPORAL_ADDRESS && {
        TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS,
      }),
      ...(process.env.TEST_TEMPORAL_NAMESPACE && {
        TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE,
      }),
    },
  },
});
