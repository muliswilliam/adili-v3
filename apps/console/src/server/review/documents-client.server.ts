import { createDocumentsClient, type DocumentsClient } from '../documents/client';
import { env } from '../env.server';

/**
 * The documents client of the review workspace, as the signed-in reviewer or supervisor: their
 * download of the letters the administrative action ladder issued. Under REVIEW_MOCK the actions mock
 * answers, as it knows the letters it issued.
 */
export function reviewDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) =>
            (await import('./actions-mock.server')).mockActionDocumentsFetch(request)
        : null,
  });
}
