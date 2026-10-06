import { mockableClient } from '@adili/api-kit/client';

import type { paths as directoryPaths } from '../directory/api.gen';
import { DIRECTORY_TIMEOUTS_MS } from '../directory/client';
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

/**
 * Typed directory client for the one directory read the audit trail makes: the name of the person
 * an event is about (`GET /v1/persons/{personId}/name`), called as the signed-in auditor. The
 * directory admits auditors only and audits the read. Mocked with the trail (AUDIT_MOCK).
 */
export function auditPersonsClient(accessToken: string) {
  const config = env();
  return mockableClient<directoryPaths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: DIRECTORY_TIMEOUTS_MS.read,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.AUDIT_MOCK
        ? async (request) => (await import('./mock.server')).mockAuditPersonsFetch(request)
        : null,
  });
}

export type AuditPersonsClient = ReturnType<typeof auditPersonsClient>;
