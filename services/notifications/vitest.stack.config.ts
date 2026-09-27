import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs the compose stack (Postgres, Mailpit) and the mocks (`pnpm --filter @adili/mocks dev`).
// Not part of CI yet; run with `pnpm test:stack`.
const env = parseEnv(readFileSync('.env.example', 'utf8'));

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.stack.test.ts'],
    testTimeout: 30_000,
    env: {
      ...env,
      LOG_LEVEL: 'fatal',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://adili_test:adili_test_dev@localhost:55432/adili_test',
      TEST_MAILPIT_URL: process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025',
      SMS_GATEWAY_URL: process.env.SMS_GATEWAY_URL ?? env.SMS_GATEWAY_URL ?? '',
    },
  },
});
