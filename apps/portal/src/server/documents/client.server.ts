import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the documents service, generated from
 * `packages/schemas/internal/documents.yaml`, called as the signed-in person. `mock` answers in
 * development instead of the service; callers pass it inline, behind `import.meta.env.DEV`, so
 * production builds drop it (see mockableClient).
 */
export function createDocumentsClient({
  accessToken,
  mock,
}: {
  accessToken: string;
  mock: ((request: Request) => Promise<Response>) | null;
}) {
  return mockableClient<paths>({
    baseUrl: env().DOCUMENTS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    mock,
  });
}

export type DocumentsClient = ReturnType<typeof createDocumentsClient>;

/**
 * The documents service's uploads as the signed-in declarant. Mocked under DECLARATIONS_MOCK,
 * with the drafts, so linking sees the mock's uploads.
 */
export function documentsClient(accessToken: string): DocumentsClient {
  return createDocumentsClient({
    accessToken,
    mock:
      import.meta.env.DEV && env().DECLARATIONS_MOCK
        ? async (request) => (await import('./mock.server')).mockDocumentsFetch(request)
        : null,
  });
}
