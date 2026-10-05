import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rabbitmqUrl = process.env.TEST_RABBITMQ_URL ?? 'amqp://adili:adili_dev@localhost:55672';

// Needs Postgres, Valkey, Temporal and RabbitMQ (`pnpm infra:up`); CI overrides the defaults. Other
// services are faked.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globalSetup: ['test/support/workflow-bundles.ts'],
    setupFiles: ['test/support/temporal-task-queue.ts'],
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      // Suites ask many questions as one declarant; the limit itself is api-kit's, tested there.
      RATE_LIMITS: 'assistant=1000/60s',
      TEMPORAL_ADDRESS: process.env.TEST_TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEMPORAL_NAMESPACE: process.env.TEST_TEMPORAL_NAMESPACE ?? 'adili',
      VALKEY_URL: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
      TEST_RABBITMQ_URL: rabbitmqUrl,
      // The broker the readiness check connects to at startup: the suite's, as CI's runs on 5672.
      // Left at .env.example's 55672, where nothing listens in CI, a connect can reach itself (the
      // port is in Linux's ephemeral range) and stall the app's start (see
      // RABBITMQ_CONNECT_TIMEOUT_MS in @adili/events).
      RABBITMQ_URL: rabbitmqUrl,
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
    },
  },
});
