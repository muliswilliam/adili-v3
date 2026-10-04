import { env } from '../env.server';
import { createDocumentsClient, type DocumentsClient } from './client';

/**
 * The documents client of EACC's report viewer, as the signed-in analyst or supervisor: the
 * downloads of a filed report's Form M PDF and receipt. Under REPORTING_MOCK the intake mock
 * answers, as it knows the documents its reports point at.
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
            (await import('../reporting/eacc-mock.server')).mockReportingDocumentsFetch(request)
        : null,
  });
}
