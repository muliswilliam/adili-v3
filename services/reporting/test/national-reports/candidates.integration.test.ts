import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { complianceReports, reportReceipts } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { COMMISSION_ADMIN, SUPERVISOR } from '../support/form-m-facts.js';
import {
  FY2027_CANDIDATES,
  HISTORY,
  HISTORY_COMMISSIONS,
  HISTORY_FYS,
  type HistoryFy,
} from '../support/ncr-history.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * S1 through the HTTP API on real Postgres: the Commissions' submitted reports for FY 2025 to
 * FY 2027 (`ncr-history.ts`), each year's NCR built by an EACC analyst; the FY 2027 candidates
 * are computed from its aggregates and the two years before, in the contract's shape. EACC
 * analysts and supervisors only.
 */
describe('NCR pattern candidates endpoint (S1)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = { sub: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
  const EACC_SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
  };
  const PSC_REVIEWER: Caller = { sub: 'reviewer-psc', tenant: 'psc', roles: ['reviewer'] };
  /** EACC's role held for another tenant: not an EACC account. */
  const ANALYST_OF_PSC: Caller = { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] };

  const CANDIDATES = '/v1/eacc/national-reports/{fy}/candidates';
  const candidatesOf = (fy: number, caller: Caller) =>
    api.get(`/v1/eacc/national-reports/${String(fy)}/candidates`, caller);

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    for (const { slug } of HISTORY_COMMISSIONS) api.directory.givenCommission(slug);
  });

  /** The year's reports as submitted, and EACC's receipts of them. */
  async function givenSubmitted(fy: HistoryFy): Promise<void> {
    await api.asPlatform(async (tx) => {
      for (const { tenant, late, counts } of HISTORY[fy]) {
        const reportId = uuidv7();
        const reference = `RPT-${tenant.toUpperCase()}-${String(fy + 1)}-0000001-X`;
        const submittedAt = new Date(`${String(fy + 1)}-${late ? '08-05' : '07-20'}T07:00:00Z`);
        const report = { tenant, fy, reference, source: 'hosted' as const, submittedAt, late };
        await tx
          .insert(complianceReports)
          .values({ id: reportId, status: 'submitted', counts, ...report });
        await tx.insert(reportReceipts).values({ reportId, counts, ...report });
      }
    });
  }

  async function built(fy: HistoryFy): Promise<void> {
    const response = await api.send(
      'POST',
      `/v1/eacc/national-reports/${String(fy)}/build`,
      ANALYST,
    );
    expect(response.statusCode, response.body).toBe(200);
  }

  async function givenHistoryBuilt(): Promise<void> {
    for (const fy of HISTORY_FYS) {
      await givenSubmitted(fy);
      await built(fy);
    }
  }

  it('S1: an eacc-analyst gets the doubled non-filer rate, the three-year late reporter and the clarification outlier, with values and keys', async () => {
    await givenHistoryBuilt();

    const response = await candidatesOf(2027, ANALYST);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<unknown>();
    expect(contractErrors(okResponse(CANDIDATES, 'get'), body)).toEqual([]);
    expect(body).toEqual(FY2027_CANDIDATES);
  });

  it('S1: an eacc-supervisor gets the same candidates', async () => {
    await givenHistoryBuilt();

    const response = await candidatesOf(2027, EACC_SUPERVISOR);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual(FY2027_CANDIDATES);
  });

  it('S1: a year built without prior years has no year-on-year candidates', async () => {
    await givenSubmitted(2027);
    await built(2027);

    const response = await candidatesOf(2027, ANALYST);

    expect(response.statusCode, response.body).toBe(200);
    const kinds = response.json<{ kind: string }[]>().map((each) => each.kind);
    expect(kinds).not.toContain('rate-change');
    expect(kinds).not.toContain('chronic-late-reporting');
    expect(kinds).toContain('clarification-ratio-outlier');
  });

  it('S1: 404 before the year is built', async () => {
    await givenSubmitted(2027);

    const response = await candidatesOf(2027, ANALYST);

    expect(response.statusCode, response.body).toBe(404);
  });

  it.each([
    ['a Commission supervisor', SUPERVISOR],
    ['a commission-admin', COMMISSION_ADMIN],
    ['a Commission reviewer', PSC_REVIEWER],
    ['an eacc-analyst role held for a Commission', ANALYST_OF_PSC],
  ])('S1: %s gets 403', async (_, caller) => {
    await givenHistoryBuilt();

    const response = await candidatesOf(2027, caller);

    expect(response.statusCode, response.body).toBe(403);
  });
});
