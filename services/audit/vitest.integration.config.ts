import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres and Temporal (`pnpm infra:up`), and OpenBao for the signer's own suite; CI
// overrides the defaults. Object storage and the anchors' signer are faked elsewhere. Events are
// handed to the consumer as the RabbitMQ transport would, so no broker is needed.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: ['test/support/workflow-bundles.ts'],
    setupFiles: ['test/support/temporal-task-queue.ts'],
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      // Suites run the anchoring themselves; a schedule would fire on the shared Temporal.
      AUDIT_ANCHOR_CRON: 'off',
      TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE ?? 'adili',
      TEST_OPENBAO_URL: process.env.TEST_OPENBAO_URL ?? 'http://localhost:8200',
      TEST_OPENBAO_TOKEN: process.env.TEST_OPENBAO_TOKEN ?? 'adili-dev-root-token',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
    },
  },
});
