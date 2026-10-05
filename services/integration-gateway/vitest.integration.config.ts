import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres, Valkey and RabbitMQ. Defaults point at local infra (`pnpm infra:up`); CI
// overrides them.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    // Above Vitest's 10 s default, as every other service's suite (30 to 60 s): on a loaded
    // runner the app start (migrations, Nest init) and the per-test cleanup can outlast it.
    hookTimeout: 30_000,
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
      TEST_VALKEY_URL: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
      // The broker the readiness check connects to at startup. CI's runs on 5672; left at
      // .env.example's 55672 there, a connect to the unused port could reach itself (see
      // RABBITMQ_CONNECT_TIMEOUT_MS in @adili/events).
      ...(process.env.TEST_RABBITMQ_URL && { RABBITMQ_URL: process.env.TEST_RABBITMQ_URL }),
    },
  },
});
