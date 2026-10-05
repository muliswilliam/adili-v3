import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres, Temporal, SeaweedFS (S3, the `open-data` bucket) and Valkey (the public API's
// rate limiter) (`pnpm infra:up`); CI overrides the defaults. Other services are faked.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    // One file at a time: the workflow id is the Commission and year, so two suites compiling
    // psc 2027 on the shared Temporal would signal each other's workflows.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: ['test/support/workflow-bundles.ts'],
    setupFiles: ['test/support/temporal-task-queue.ts'],
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      // The broker the readiness check connects to at startup: CI's runs on 5672. Left at
      // .env.example's 55672, where nothing listens in CI, a connect can reach itself (the port is
      // in Linux's ephemeral range) and stall the app's start (see RABBITMQ_CONNECT_TIMEOUT_MS).
      ...(process.env.TEST_RABBITMQ_URL && { RABBITMQ_URL: process.env.TEST_RABBITMQ_URL }),
      // Suites start the yearly compile and the chase themselves; a schedule would fire on the
      // shared Temporal.
      ANNUAL_COMPILE_CRON: 'off',
      NATIONAL_CHASE_CRON: 'off',
      // Retries of an unreachable ICMS back off by milliseconds, not half seconds.
      ICMS_PUSH_BACKOFF_MS: '5',
      TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE ?? 'adili',
      TEST_VALKEY_URL: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
      TEST_S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8333',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
    },
  },
});
