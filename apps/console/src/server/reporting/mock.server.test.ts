import { describe, expect, it, vi } from 'vitest';

import { mockReportingClient, resetReportingMock, setReportingMockLatency } from './mock.server';

vi.mock('../env.server', () => ({ env: () => ({}) }));

const SUPERVISOR = 'supervisor';
const COMMISSION_ADMIN = 'commission-admin';
const REPORT = '/v1/commissions/{slug}/compliance-reports/{fy}';

describe('the Form M mock, as the service (#556)', () => {
  it('marks a report compiled before 1 July a preview, and refuses to sign it off', async () => {
    // 10 May 2027: FY 2026/2027 can be previewed, and its final draft compiles on 1 July.
    resetReportingMock('2027-05-10');
    setReportingMockLatency(0, { compileMs: 0 });
    const supervisor = mockReportingClient([SUPERVISOR]);
    const params = { params: { path: { slug: 'psc', fy: 2026 } } };
    await supervisor.POST(`${REPORT}/compile`, params);
    const report = await vi.waitFor(async () => {
      const { data } = await supervisor.GET(REPORT, params);
      if (data?.status !== 'draft') throw new Error('still compiling');
      return data;
    });
    expect(report.preview).toBe(true);

    const reviewed = await supervisor.POST(`${REPORT}/reviewed`, {
      ...params,
      body: { designation: 'Director' },
    });
    expect(reviewed.response.status).toBe(409);
    expect(reviewed.error).toMatchObject({ code: 'report-preview' });

    const admin = mockReportingClient([COMMISSION_ADMIN], { stepUpAt: Date.now() });
    const confirmed = await admin.POST(`${REPORT}/confirm`, {
      params: { ...params.params, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: {},
    });
    expect(confirmed.response.status).toBe(409);
    expect(confirmed.error).toMatchObject({ code: 'report-preview' });
  });
});
