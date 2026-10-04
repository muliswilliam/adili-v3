import {
  COMMISSION_ADMIN,
  EACC_ANALYST,
  REPORTING_OFFICER,
  REVIEWER,
  SUPERVISOR,
} from '@adili/roles';
import createClient from 'openapi-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { json } from './mock-http';
import { loadCommissionOpenDataPreview } from './open-data-preview.server';
import type { paths } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from './reporting/mock.server';
import type { OpenDataMockScenario } from './reporting/open-data-mock.server';

const pscAdmin = () => mockReportingClient([COMMISSION_ADMIN]);
const reset = (openData: OpenDataMockScenario = 'published') => {
  resetReportingMock('2026-10-03', { openData });
};

beforeAll(() => {
  setReportingMockLatency(0);
});
afterAll(() => {
  setReportingMockLatency(1);
});

async function preview(client: ReportingClient, slug = 'psc') {
  const result = await loadCommissionOpenDataPreview(client, slug);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

describe("a Commission's open-data preview (spec 09b S6)", () => {
  it('gives the latest published release and only the Commission its own rows', async () => {
    reset();
    const data = await preview(pscAdmin());
    expect(data.release).toMatchObject({ fy: 2025, kind: 'annual', version: 1 });
    expect(data.release.status).toBe('published');
    expect(data.filing.map((row) => [row.commission, row.cycle])).toEqual([
      ['psc', 'initial'],
      ['psc', 'biennial'],
      ['psc', 'final'],
      ['psc', 'all'],
    ]);
    expect(data.filing[3]).toMatchObject({ expected: 50312, filed: 48879, nonFilers: 1433 });
    expect(data.compliance).toMatchObject({ commission: 'psc', determinationsCompliant: 16054 });
    expect(data.accessRequests).toMatchObject({ commission: 'psc', received: 14, granted: 11 });
  });

  it('gives a preview built since the last publication, its suppressed rows marked', async () => {
    reset('preview');
    const data = await preview(pscAdmin());
    expect(data.release).toMatchObject({ fy: 2026, kind: 'snapshot', status: 'preview' });
    expect(data.release.publishedAt).toBeNull();
    // Its final cycle is under 10 officers, so its initial one is hidden with it; the total stays.
    expect(data.filing.filter((row) => row.suppressed).map((row) => row.cycle)).toEqual([
      'initial',
      'final',
    ]);
    expect(data.filing.find((row) => row.cycle === 'all')).toMatchObject({
      expected: 663,
      filed: 602,
      suppressed: false,
    });
    expect(data.compliance).toMatchObject({ suppressed: false, determinationsCompliant: 254 });
  });

  it('hides with a small cycle what would give it away, as the service does', async () => {
    reset();
    // TSC's final cycle is under 10 officers: its initial one goes with it (its row), and JSC's
    // final and initial ones (the final column, then JSC's row); PSC's stay shown.
    const hidden = async (tenant: string) =>
      (await preview(mockReportingClient([COMMISSION_ADMIN], { tenant }), tenant)).filing
        .filter((row) => row.suppressed)
        .map((row) => row.cycle);
    expect(await hidden('tsc')).toEqual(['initial', 'final']);
    expect(await hidden('jsc')).toEqual(['initial', 'final']);
    expect(await hidden('psc')).toEqual([]);
  });

  it('answers 404 while no release has been built', async () => {
    reset('none');
    const result = await loadCommissionOpenDataPreview(pscAdmin(), 'psc');
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it("answers 403 to the Commission's other Form M roles and 404 to anyone else", async () => {
    reset();
    for (const role of [REPORTING_OFFICER, SUPERVISOR]) {
      const officer = mockReportingClient([role]);
      expect(await loadCommissionOpenDataPreview(officer, 'psc')).toMatchObject({
        ok: false,
        error: { kind: 'problem', problem: { status: 403 } },
      });
    }
    const reviewer = mockReportingClient([REVIEWER]);
    expect(await loadCommissionOpenDataPreview(reviewer, 'psc')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
    const otherAdmin = mockReportingClient([COMMISSION_ADMIN], { tenant: 'tsc' });
    const analyst = mockReportingClient([EACC_ANALYST], { tenant: 'eacc' });
    for (const client of [otherAdmin, analyst]) {
      expect(await loadCommissionOpenDataPreview(client, 'psc')).toMatchObject({
        ok: false,
        error: { kind: 'problem', problem: { status: 404 } },
      });
    }
  });

  it('reads as unavailable when object storage is down', async () => {
    reset('unavailable');
    expect(await loadCommissionOpenDataPreview(pscAdmin(), 'psc')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  it('reads as unavailable when a row is not in the shape the release tables have', async () => {
    const drifted = createClient<paths>({
      baseUrl: 'http://reporting.test',
      fetch: () =>
        Promise.resolve(
          json(200, {
            release: {
              id: '0190f3a2-0000-7000-8000-000000000001',
              fy: 2025,
              kind: 'annual',
              version: 1,
              status: 'published',
              builtAt: '2026-09-18T07:00:00.000Z',
              publishedAt: '2026-09-18T07:00:00.000Z',
              withdrawnAt: null,
              withdrawnReason: null,
              manifestVerificationId: null,
              tables: [],
            },
            tables: {
              'filing-by-commission': [{ commission: 'psc', cycle: 'all', expected: '12' }],
              'compliance-by-commission': [],
              'access-requests': [],
            },
          }),
        ),
    });
    expect(await loadCommissionOpenDataPreview(drifted, 'psc')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });
});
