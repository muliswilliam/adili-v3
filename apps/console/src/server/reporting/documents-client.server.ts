import { createDocumentsClient, type DocumentsClient } from '../documents/client';
import { env } from '../env.server';

/**
 * The documents client of the Form M workspace, as the signed-in Commission officer: the
 * downloads of a submitted report's Form M PDF and acknowledgement receipt. Under REPORTING_MOCK
 * it is answered by the reporting mock, which knows the documents it issued.
 */
export function reportingDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REPORTING_MOCK
        ? async (request) => (await import('./mock.server')).mockReportingDocumentsFetch(request)
        : null,
  });
}
