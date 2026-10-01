import { mockableClient } from '@adili/api-kit/client';

import type { paths as DocumentsPaths } from '../documents/schema.gen';
import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the access service's applicant endpoints (Form K, My requests, withdraw),
 * generated from `packages/schemas/internal/access.yaml`, called as the signed-in applicant.
 * With ACCESS_MOCK set in development it talks to the in-memory mock instead
 * (`mock.server.ts`).
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

/**
 * The documents service as the signed-in applicant, for their access packages: documents hands
 * a package's download link to its subject person only, so the portal asks with the
 * applicant's own token (access has no download route). Mocked by the access mock under
 * ACCESS_MOCK, since it holds the packages.
 */
export function packageDocumentsClient(accessToken: string) {
  const config = env();
  return mockableClient<DocumentsPaths>({
    baseUrl: config.DOCUMENTS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.ACCESS_MOCK
        ? async (request) => (await import('./mock.server')).mockAccessFetch(request)
        : null,
  });
}

export type PackageDocumentsClient = ReturnType<typeof packageDocumentsClient>;
