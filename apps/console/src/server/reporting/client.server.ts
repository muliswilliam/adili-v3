import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * Typed client for the reporting service, generated from `packages/schemas/internal/reporting.yaml`,
 * called as the signed-in Commission officer (supervisor, commission-admin or reporting officer).
 * With REPORTING_MOCK set in development it talks to the in-memory mock instead (`mock.server.ts`).
 */
export function reportingClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.REPORTING_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REPORTING_MOCK
        ? async (request) => (await import('./mock.server')).mockReportingFetch(request)
        : null,
  });
}

export type ReportingClient = ReturnType<typeof reportingClient>;
