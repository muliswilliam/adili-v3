import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * Typed client for the access service, generated from `packages/schemas/internal/access.yaml`,
 * called as the signed-in access officer or supervisor. With ACCESS_MOCK set in development it
 * talks to the in-memory mock instead (`mock.server.ts`).
 */
export function accessClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.ACCESS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.ACCESS_MOCK
        ? async (request) => (await import('./mock.server')).mockAccessFetch(request)
        : null,
  });
}

export type AccessClient = ReturnType<typeof accessClient>;
