import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * Typed client for the audit service's trail (`packages/schemas/internal/audit.yaml`), called as
 * the signed-in auditor. With AUDIT_MOCK set in development it talks to the in-memory mock
 * instead (`mock.server.ts`).
 */
export function auditClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.AUDIT_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.AUDIT_MOCK
        ? async (request) => (await import('./mock.server')).mockAuditFetch(request)
        : null,
  });
}

export type AuditClient = ReturnType<typeof auditClient>;
