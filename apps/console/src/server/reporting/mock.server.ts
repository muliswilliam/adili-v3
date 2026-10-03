import { problem } from '../mock-http';
import { mockOpenDataFetch } from './open-data-mock.server';

/**
 * The reporting service in memory, behind REPORTING_MOCK in development and tests: the
 * Commission open-data preview (spec 09b, `open-data-mock.server.ts`); anything else is 404.
 */
export function mockReportingFetch(request: Request): Promise<Response> {
  return Promise.resolve(mockOpenDataFetch(request) ?? problem(404, 'Not found'));
}
