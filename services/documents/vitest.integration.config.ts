import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rabbitmqUrl = process.env.TEST_RABBITMQ_URL ?? 'amqp://adili:adili_dev@localhost:55672';

// Needs Postgres, SeaweedFS (S3, with SSE-S3 configured and the ADR-002 buckets), ClamAV,
// Keycloak (with the committed realm import), Gotenberg, OpenBao (with the demo CA of
// infra/compose/openbao/create-demo-ca.sh) and RabbitMQ (the acknowledgement consumer's retries).
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
      TEST_KEYCLOAK_ISSUER_URL:
        process.env.TEST_KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/adili',
      TEST_S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8333',
      TEST_CLAMAV_HOST: process.env.TEST_CLAMAV_HOST ?? 'localhost',
      TEST_CLAMAV_PORT: process.env.TEST_CLAMAV_PORT ?? '3310',
      TEST_GOTENBERG_URL: process.env.TEST_GOTENBERG_URL ?? 'http://localhost:3300',
      TEST_OPENBAO_URL: process.env.TEST_OPENBAO_URL ?? 'http://localhost:8200',
      TEST_OPENBAO_TOKEN: process.env.TEST_OPENBAO_TOKEN ?? 'adili-dev-root-token',
      TEST_RABBITMQ_URL: rabbitmqUrl,
      // The broker the readiness check connects to at startup: the suite's, as CI's runs on 5672.
      // Left at .env.example's 55672, where nothing listens in CI, a connect can reach itself (the
      // port is in Linux's ephemeral range) and stall the app's start (see
      // RABBITMQ_CONNECT_TIMEOUT_MS in @adili/events).
      RABBITMQ_URL: rabbitmqUrl,
    },
  },
});
