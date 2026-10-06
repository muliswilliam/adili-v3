import { env } from '../env.server';
import { createDocumentsClient, type DocumentsClient } from './client';

/**
 * The documents client for referral evidence package downloads, as the signed-in officer. Under
 * REVIEW_MOCK the review mock answers, as it knows the packages it issued.
 */
export function letterDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) => (await import('../review/mock.server')).mockLetterFetch(request)
        : null,
  });
}
