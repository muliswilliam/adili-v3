import {
  COMMISSION_ADMIN,
  EACC_ANALYST,
  EACC_SUPERVISOR,
  REPORTING_OFFICER,
  REVIEWER,
  SUPERVISOR,
} from '@adili/roles';
import createClient from 'openapi-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { json } from './mock-http';
import { loadCommissionOpenDataPreview } from './open-data-preview.server';
import {
  buildOpenDataSnapshot,
  listOpenDataReleases,
  publishOpenDataRelease,
  withdrawOpenDataRelease,
} from './open-data-releases.server';
import type { paths } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from './reporting/mock.server';
import { resetNcrMock } from './reporting/ncr-mock.server';
import { type ReleasesMockSeed, resetReleasesMock } from './reporting/releases-mock.server';

const pscAdmin = () => mockReportingClient([COMMISSION_ADMIN]);
const analyst = () => mockReportingClient([EACC_ANALYST], { tenant: 'eacc' });
const supervisor = () =>
  mockReportingClient([EACC_SUPERVISOR], { tenant: 'eacc', name: 'Esther Chebet' });
const reset = (releases: ReleasesMockSeed = 'history') => {
  resetReportingMock('2026-10-03');
  resetNcrMock('not-built');
  resetReleasesMock(releases);
};

async function eaccReleases() {
  const result = await listOpenDataReleases(analyst());
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

beforeAll(() => {
  setReportingMockLatency(0);
});
afterAll(() => {
  setReportingMockLatency(1);
});

/** EACC's step on the releases mock, its answer unwrapped. */
async function eacc<T>(step: Promise<{ ok: true; data: T } | { ok: false; error: unknown }>) {
  const result = await step;
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

async function preview(client: ReportingClient, slug = 'psc') {
  const result = await loadCommissionOpenDataPreview(client, slug);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

describe("a Commission's open-data preview (spec 09b S6)", () => {
  it("shows the release EACC's list has as current, never a withdrawn one", async () => {
    reset();
    const data = await preview(pscAdmin());
    const current = (await eaccReleases()).find((each) => each.status === 'published');
    expect(data.release).toMatchObject({ fy: 2025, kind: 'snapshot', version: 2 });
    expect(data.release.id).toBe(current?.id);
    expect(data.release.manifestVerificationId).toBe(current?.manifestVerificationId);
    expect(data.release.tables).toEqual(current?.tables);
  });

  it('follows what EACC builds, publishes and withdraws', async () => {
    reset();
    const built = await eacc(buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID()));
    expect((await preview(pscAdmin())).release).toMatchObject({ id: built.id, status: 'preview' });

    await eacc(publishOpenDataRelease(supervisor(), built.id, crypto.randomUUID()));
    expect((await preview(pscAdmin())).release).toMatchObject({
      id: built.id,
      status: 'published',
    });

    const reason = 'Counted a board twice.';
    await eacc(withdrawOpenDataRelease(supervisor(), built.id, reason, crypto.randomUUID()));
    expect((await preview(pscAdmin())).release).toMatchObject({
      fy: 2025,
      kind: 'snapshot',
      version: 2,
    });
  });

  it('gives the latest published release and only the Commission its own rows', async () => {
    reset();
    const data = await preview(pscAdmin());
    expect(data.release.status).toBe('published');
    // FY 2025/2026's mid-year counts: PSC had not reported, so its own roster's.
    expect(data.filing.map((row) => [row.commission, row.cycle, row.expected, row.filed])).toEqual([
      ['psc', 'initial', 214, 126],
      ['psc', 'biennial', 2890, 1702],
      ['psc', 'final', 96, 55],
      ['psc', 'all', 3200, 1883],
    ]);
    expect(data.compliance).toMatchObject({ commission: 'psc', clarificationsIssued: 2 });
    expect(data.accessRequests).toMatchObject({ commission: 'psc' });
  });

  it('gives a preview built since the last publication, its suppressed rows marked', async () => {
    reset();
    await eacc(buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID()));
    const data = await preview(
      mockReportingClient([COMMISSION_ADMIN], { tenant: 'cpsb042' }),
      'cpsb042',
    );
    expect(data.release).toMatchObject({ fy: 2026, kind: 'snapshot', status: 'preview' });
    expect(data.release.publishedAt).toBeNull();
    // Its initial cycle is under 10 officers, so its final one is hidden with it; the total stays.
    expect(data.filing.filter((row) => row.suppressed).map((row) => row.cycle)).toEqual([
      'initial',
      'final',
    ]);
    expect(data.filing.find((row) => row.cycle === 'all')).toMatchObject({
      expected: 30,
      filed: 26,
      suppressed: false,
    });
  });

  it('hides with a small cycle what would give it away, as the service does', async () => {
    reset();
    // The Kisii and Kisumu boards' final cycles are under 10 officers: their initial ones go
    // with them; PSC's stay shown.
    const hidden = async (tenant: string) =>
      (await preview(mockReportingClient([COMMISSION_ADMIN], { tenant }), tenant)).filing
        .filter((row) => row.suppressed)
        .map((row) => row.cycle);
    expect(await hidden('cpsb045')).toEqual(['initial', 'final']);
    expect(await hidden('cpsb042')).toEqual(['initial', 'final']);
    expect(await hidden('psc')).toEqual([]);
  });

  it("marks a Commission's figures as not reported in the annual release", async () => {
    reset();
    resetNcrMock('approved');
    const data = await preview(pscAdmin());
    expect(data.release).toMatchObject({ fy: 2025, kind: 'annual', status: 'published' });
    expect(data.filing.map((row) => row.expected)).toEqual([null, null, null, null]);
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
