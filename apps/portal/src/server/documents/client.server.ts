import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the documents service's uploads, generated from
 * `packages/schemas/internal/documents.yaml`, called as the signed-in declarant. Mocked under
 * DECLARATIONS_DRAFTS_MOCK, with the drafts, so linking sees the mock's uploads.
 */
export function documentsClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DOCUMENTS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.DECLARATIONS_DRAFTS_MOCK
        ? async (request) => (await import('./mock.server')).mockDocumentsFetch(request)
        : null,
  });
}

export type DocumentsClient = ReturnType<typeof documentsClient>;
