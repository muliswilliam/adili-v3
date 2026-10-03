import { mockReportingDocumentsFetch } from './eacc-mock.server';
import { mockNcrDocumentsFetch } from './ncr-mock.server';

/**
 * Documents' downloads for EACC's compliance reports under REPORTING_MOCK
 * (`documents/report-client.server.ts`): the national consolidated report's PDF from the national
 * report mock, a filed Form M's PDF and receipt from the intake mock, anything else 404.
 */
export async function mockReportDocumentsFetch(request: Request): Promise<Response> {
  return (await mockNcrDocumentsFetch(request)) ?? mockReportingDocumentsFetch(request);
}
