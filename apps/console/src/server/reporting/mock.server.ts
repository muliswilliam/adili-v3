/**
 * In-memory stand-in for the reporting service, used when REPORTING_MOCK is set, for screens
 * without the reporting service and its upstreams (review, integration-gateway, ICMS, Temporal)
 * running. Each area of the contract answers from its own module; so far EACC's referrals
 * intake (`referral-intake-mock.server.ts`). Any other path is a 404.
 */
import createClient from 'openapi-fetch';

import { problem, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import { referralIntakeFetch } from './referral-intake-mock.server';

export function mockReportingFetch(request: Request): Promise<Response> {
  return Promise.resolve(referralIntakeFetch(request) ?? problem(404, 'Not found'));
}

/** A reporting client answered by the mock, as `name` with `roles`, for tests. */
export function mockReportingClient(name: string, roles: readonly string[]) {
  const token = unsignedMockToken({
    subject: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    roles,
  });
  return createClient<paths>({
    baseUrl: 'http://reporting.test',
    headers: { authorization: `Bearer ${token}` },
    fetch: mockReportingFetch,
  });
}
