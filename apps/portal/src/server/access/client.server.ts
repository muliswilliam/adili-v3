import { mockableClient } from '@adili/api-kit/client';

import { createDocumentsClient, type DocumentsClient } from '../documents/client.server';
import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the access service (the applicant's Form K and requests, the declarant's
 * notices, history and certified copies),
 * generated from `packages/schemas/internal/access.yaml`, called as the signed-in user.
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
 * The documents service as the signed-in person a document was issued to: documents hands a
 * download link to the document's subject person only, so the portal asks with their own token
 * (access has no download route). Applicants download their access packages and declarants
 * their certified copies this way. Mocked by the access mock under ACCESS_MOCK, since it holds
 * both.
 */
export function subjectDocumentsClient(accessToken: string): DocumentsClient {
  return createDocumentsClient({
    accessToken,
    mock:
      import.meta.env.DEV && env().ACCESS_MOCK
        ? async (request) => (await import('./mock.server')).mockAccessFetch(request)
        : null,
  });
}

export type SubjectDocumentsClient = DocumentsClient;
