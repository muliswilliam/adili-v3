import { env } from '../env.server';
import { mockableClient } from '../mockable-client.server';
import type { paths } from './api.gen';

/**
 * Typed client for the documents service, generated from
 * `packages/schemas/internal/documents.yaml`, for clarification letter downloads. Shares the
 * REVIEW_MOCK flag: the review mock answers for the letters it issued.
 */
export function documentsClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DOCUMENTS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) => (await import('../review/mock.server')).mockDocumentsFetch(request)
        : null,
  });
}
