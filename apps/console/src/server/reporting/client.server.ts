import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * How long the console waits for the reporting service. A push to ICMS holds the request while
 * reporting reads the referral's payload from review (up to 10 s) and submits it through the
 * integration-gateway, up to 3 attempts of 15 s with backoff between them, so the console allows
 * that plus headroom: giving up first would show a failure for a push still in flight. A retry
 * reuses the Idempotency-Key, and a registered referral is never sent again.
 */
export const REPORTING_TIMEOUTS_MS = { default: 10_000, icmsPush: 65_000 } as const;

/** The timeout of one reporting call, from its method and path. */
export function reportingTimeoutMs(method: string, path: string): number {
  if (method === 'POST' && /\/v1\/eacc\/referrals\/[^/]+\/push$/.test(path)) {
    return REPORTING_TIMEOUTS_MS.icmsPush;
  }
  return REPORTING_TIMEOUTS_MS.default;
}

/**
 * Typed client for the reporting service, generated from `packages/schemas/internal/reporting.yaml`,
 * called as the signed-in user. With REPORTING_MOCK set in development it talks to the in-memory
 * mock instead (`mock.server.ts`).
 */
export function reportingClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.REPORTING_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: (request) => reportingTimeoutMs(request.method, new URL(request.url).pathname),
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REPORTING_MOCK
        ? async (request) => (await import('./mock.server')).mockReportingFetch(request)
        : null,
  });
}

export type ReportingClient = ReturnType<typeof reportingClient>;
