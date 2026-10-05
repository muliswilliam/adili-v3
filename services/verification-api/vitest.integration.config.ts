import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres and Valkey (`pnpm infra:up`); CI overrides the defaults. Events are handed to
// the consumers as the RabbitMQ transport would, so no broker is needed.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      // The broker the readiness check connects to at startup: CI's runs on 5672. Left at
      // .env.example's 55672, where nothing listens in CI, a connect can reach itself (the port is
      // in Linux's ephemeral range) and stall the app's start (see RABBITMQ_CONNECT_TIMEOUT_MS).
      ...(process.env.TEST_RABBITMQ_URL && { RABBITMQ_URL: process.env.TEST_RABBITMQ_URL }),
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
      TEST_VALKEY_URL: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
    },
  },
});
