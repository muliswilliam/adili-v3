import { env } from '../env.server';
import { createDocumentsClient, type DocumentsClient } from './client';

/**
 * The documents client of compliance reports, as the signed-in viewer: the downloads of a
 * report's Form M PDF and receipt, by its Commission's officers in the Form M workspace and by EACC
 * analysts and supervisors, and of the national consolidated report's PDF. Under REPORTING_MOCK
 * the reporting mocks answer (`report-documents-mock.server.ts`), as they know the documents
 * their reports point at.
 */
export function reportDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REPORTING_MOCK
        ? async (request) =>
            (await import('../reporting/report-documents-mock.server')).mockReportDocumentsFetch(
              request,
            )
        : null,
  });
}
