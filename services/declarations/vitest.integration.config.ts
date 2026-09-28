import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Postgres, Temporal and RabbitMQ (`pnpm infra:up`); CI overrides the defaults. Other
// services are faked.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    setupFiles: ['test/support/temporal-task-queue.ts'],
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE ?? 'adili',
      TEST_RABBITMQ_URL: process.env.TEST_RABBITMQ_URL ?? 'amqp://adili:adili_dev@localhost:55672',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
    },
  },
});
