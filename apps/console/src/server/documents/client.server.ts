import { env } from '../env.server';
import { createDocumentsClient, type DocumentsClient } from './client';

/**
 * The documents client for clarification letter downloads: the same client as uploads (with
 * its per-call timeouts), answered by the review mock under REVIEW_MOCK, which knows the
 * letters it issued.
 */
export function documentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) => (await import('../review/mock.server')).mockDocumentsFetch(request)
        : null,
  });
}
