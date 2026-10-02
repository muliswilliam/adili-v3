import { env } from '../env.server';
import { createDocumentsClient, type DocumentsClient } from './client';

/**
 * The documents client for access package downloads, as the officer the package was issued to.
 * Under ACCESS_MOCK the access mock answers, as it knows the packages it issued.
 */
export function packageDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.ACCESS_MOCK
        ? async (request) => (await import('../access/lea-mock.server')).mockPackageFetch(request)
        : null,
  });
}
