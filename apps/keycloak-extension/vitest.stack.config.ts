import { defineConfig } from 'vitest/config';

// Needs the compose stack with Keycloak built from this branch (`pnpm infra:up`), the notifications
// service (`pnpm --filter @adili/notifications dev`) and the mocks (`pnpm --filter @adili/mocks dev`).
// CI runs it at the end of the integration job; locally, `pnpm --filter @adili/keycloak-extension test:stack`.
export default defineConfig({
  test: {
    include: ['test/**/*.stack.test.ts'],
    testTimeout: 60_000,
    // One Keycloak, Mailpit and SMS inbox: the cases share demo users, so they run in order.
    fileParallelism: false,
    env: {
      TEST_KEYCLOAK_URL: process.env.TEST_KEYCLOAK_URL ?? 'http://localhost:8080',
      TEST_MAILPIT_URL: process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025',
      TEST_MOCKS_URL: process.env.TEST_MOCKS_URL ?? 'http://localhost:8000',
    },
  },
});
