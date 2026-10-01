import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres, Valkey, Keycloak (with the committed realm import), Mailpit and Temporal. Defaults
// point at local infra (`pnpm infra:up`); CI overrides them.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: ['test/support/workflow-bundles.ts'],
    setupFiles: ['test/support/temporal-task-queue.ts'],
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE ?? 'adili',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
      TEST_VALKEY_URL: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
      TEST_KEYCLOAK_ISSUER_URL:
        process.env.TEST_KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/adili',
      TEST_MAILPIT_URL: process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025',
    },
  },
});
