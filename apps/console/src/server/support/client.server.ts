import { mockableClient } from '@adili/api-kit/client';

import type { paths } from '../directory/api.gen';
import { DIRECTORY_TIMEOUTS_MS } from '../directory/client';
import { env } from '../env.server';

/**
 * Typed directory client for the helpdesk's person lookup (`GET /v1/persons`), called as the
 * signed-in helpdesk user. With HELPDESK_MOCK set in development it talks to the in-memory mock
 * instead (`mock.server.ts`).
 */
export function supportClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: DIRECTORY_TIMEOUTS_MS.read,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.HELPDESK_MOCK
        ? async (request) => (await import('./mock.server')).mockSupportFetch(request)
        : null,
  });
}

export type SupportClient = ReturnType<typeof supportClient>;
