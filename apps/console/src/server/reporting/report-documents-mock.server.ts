import { mockCallerOf } from '../mock-http';
import { isEacc, mockEaccIntakeDocumentsFetch } from './eacc-mock.server';
import { mockWorkspaceDocumentsFetch } from './mock.server';
import { mockNcrDocumentsFetch } from './ncr-mock.server';

/**
 * Documents' downloads of compliance reports under REPORTING_MOCK
 * (`documents/report-client.server.ts`): for EACC, the national consolidated report's PDF from
 * the national report mock and a filed Form M's PDF and receipt from the intake mock; for a
 * Commission's officers, their report's PDF and receipt from the Form M workspace mock. Anything
 * else 404.
 */
export async function mockReportDocumentsFetch(request: Request): Promise<Response> {
  if (!isEacc(mockCallerOf(request))) return mockWorkspaceDocumentsFetch(request);
  return (await mockNcrDocumentsFetch(request)) ?? mockEaccIntakeDocumentsFetch(request);
}
