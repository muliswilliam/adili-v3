import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs Keycloak (with the committed realm import) and Mailpit. Defaults point at local
// infra (`pnpm infra:up`); CI overrides them.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      ...parseEnv(readFileSync('.env.example', 'utf8')),
      LOG_LEVEL: 'fatal',
      TEST_KEYCLOAK_ISSUER_URL:
        process.env.TEST_KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/adili',
      TEST_MAILPIT_URL: process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025',
    },
  },
});
