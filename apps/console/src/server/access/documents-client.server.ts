import { createDocumentsClient, type DocumentsClient } from '../documents/client';
import { env } from '../env.server';

/**
 * The documents client of the Certified copies screens, as the signed-in access officer: their
 * uploads of a representative's proofs and their download of the certified copy they hand over.
 * Under ACCESS_MOCK it is answered by the self-access mock, which knows the copies it issued.
 */
export function selfAccessDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.ACCESS_MOCK
        ? async (request) =>
            (await import('./self-access-mock.server')).mockSelfAccessDocumentsFetch(request)
        : null,
  });
}
