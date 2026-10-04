import { env } from '../env.server';
import { createDocumentsClient, type DocumentsClient } from './client';

/**
 * The documents client for EACC's downloads of referral evidence packages, as the signed-in
 * analyst or supervisor. Under REPORTING_MOCK the reporting mock answers, as it knows the
 * packages its intake holds.
 */
export function intakePackageDocumentsClient(accessToken: string): DocumentsClient {
  const config = env();
  return createDocumentsClient({
    baseUrl: config.DOCUMENTS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REPORTING_MOCK
        ? async (request) =>
            (await import('../reporting/referral-intake-mock.server')).mockIntakePackageFetch(
              request,
            )
        : null,
  });
}
