import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildOpenDataSnapshot,
  listOpenDataReleases,
  loadOpenDataRelease,
} from './open-data-releases.server';
import {
  mockReportingClient,
  mockReportingFetch,
  resetReportingMock as resetFormMMock,
  setReportingMockLatency,
} from './reporting/mock.server';
import { setEaccIntakeMockLatency } from './reporting/eacc-mock.server';
import { resetNcrMock } from './reporting/ncr-mock.server';
import { resetReleasesMock } from './reporting/releases-mock.server';

const eacc = (roles: readonly string[], name = 'Brian Otieno') =>
  mockReportingClient(roles, {
    name,
    subject: `user-${name.toLowerCase().replace(/\W+/g, '-')}`,
    tenant: 'eacc',
  });

const analyst = () => eacc(['eacc-analyst']);

beforeEach(() => {
  // FY 2025/2026's reports are in, FY 2026/2027's not due.
  resetFormMMock('2026-10-03');
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  resetNcrMock('not-built');
  resetReleasesMock('history');
});

describe('S6 listOpenDataReleases', () => {
  it("lists the year's releases, the latest version first, withdrawn ones included", async () => {
    const result = await listOpenDataReleases(analyst());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => [r.fy, r.kind, r.version, r.status])).toEqual([
      [2025, 'snapshot', 2, 'published'],
      [2025, 'snapshot', 1, 'withdrawn'],
    ]);
    expect(result.data[1]).toMatchObject({
      withdrawnBy: { name: 'Esther Chebet' },
      withdrawnReason: expect.stringContaining('Kirinyaga') as unknown,
    });
  });

  it('lists the annual release published when the NCR was approved', async () => {
    resetNcrMock('approved');

    const result = await listOpenDataReleases(analyst());

    expect(result.ok && result.data[0]).toMatchObject({
      fy: 2025,
      kind: 'annual',
      version: 1,
      status: 'published',
      publishedAt: '2026-09-25T13:40:00Z',
      publishedBy: { name: 'Esther Chebet' },
    });
  });

  it('lists nothing before any release is built', async () => {
    resetReleasesMock('none');

    expect(await listOpenDataReleases(analyst())).toEqual({ ok: true, data: [] });
  });

  it('answers 403 to anyone outside EACC', async () => {
    const result = await listOpenDataReleases(mockReportingClient(['supervisor']));

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('fails when the service is unavailable', async () => {
    resetReleasesMock('unavailable');

    expect(await listOpenDataReleases(analyst())).toMatchObject({ ok: false });
  });
});

describe('S6 buildOpenDataSnapshot', () => {
  it("builds the current year's snapshot as a preview from the live projections", async () => {
    const built = await buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID());

    expect(built).toMatchObject({
      ok: true,
      data: { fy: 2026, kind: 'snapshot', version: 1, status: 'preview', publishedBy: null },
    });
    const list = await listOpenDataReleases(analyst());
    expect(list.ok && list.data[0]?.fy).toBe(2026);
  });

  it('replays a retry with the same key instead of building again', async () => {
    const key = crypto.randomUUID();
    const first = await buildOpenDataSnapshot(analyst(), 2026, key);
    const again = await buildOpenDataSnapshot(analyst(), 2026, key);

    expect(again.ok && first.ok && again.data.id === first.data.id).toBe(true);
    const list = await listOpenDataReleases(analyst());
    expect(list.ok && list.data.filter((r) => r.fy === 2026)).toHaveLength(1);
  });

  it("builds the next version of a year's snapshot from its national report once built", async () => {
    resetNcrMock('draft');

    const built = await buildOpenDataSnapshot(eacc(['eacc-supervisor']), 2025, crypto.randomUUID());

    expect(built).toMatchObject({ ok: true, data: { fy: 2025, version: 3, status: 'preview' } });
    if (!built.ok) return;
    const detail = await loadOpenDataRelease(analyst(), built.data.id);
    expect(detail).toMatchObject({
      ok: true,
      data: { source: { kind: 'national-report', nationalReportReference: null } },
    });
  });

  it('answers a retry while the first build runs with 409 idempotency-key-in-use, then replays it', async () => {
    resetReleasesMock('history', { buildMs: 30 });
    const key = crypto.randomUUID();

    const [first, second] = await Promise.all([
      buildOpenDataSnapshot(analyst(), 2026, key),
      buildOpenDataSnapshot(analyst(), 2026, key),
    ]);
    const third = await buildOpenDataSnapshot(analyst(), 2026, key);

    expect(first).toMatchObject({ ok: true, data: { version: 1 } });
    expect(second).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, type: 'idempotency-key-in-use' } },
    });
    expect(third.ok && first.ok && third.data.id).toBe(first.ok && first.data.id);
  });

  it('answers the same key with another body with 422 idempotency-key-reused', async () => {
    const key = crypto.randomUUID();
    await buildOpenDataSnapshot(analyst(), 2026, key);

    expect(await buildOpenDataSnapshot(analyst(), 2025, key)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 422, type: 'idempotency-key-reused' } },
    });
  });

  it('replays a refusal stored for its key', async () => {
    resetReleasesMock('reconciliation-failed');
    const key = crypto.randomUUID();
    await buildOpenDataSnapshot(analyst(), 2026, key);

    expect(await buildOpenDataSnapshot(analyst(), 2026, key)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { code: 'reconciliation-failed' } },
    });
  });

  it('answers 403 to EACC roles outside the eacc tenant', async () => {
    const built = await buildOpenDataSnapshot(
      mockReportingClient(['eacc-analyst'], { tenant: 'psc' }),
      2026,
      crypto.randomUUID(),
    );

    expect(built).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it("counts a year as started from the mocks' day (REPORTING_MOCK_TODAY), not the clock", async () => {
    expect(await buildOpenDataSnapshot(analyst(), 2027, crypto.randomUUID())).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { code: 'fy-not-started' } },
    });

    resetFormMMock('2027-07-02');

    expect(await buildOpenDataSnapshot(analyst(), 2027, crypto.randomUUID())).toMatchObject({
      ok: true,
      data: { fy: 2027, status: 'preview' },
    });
  });

  it('refuses a year that has not started', async () => {
    const built = await buildOpenDataSnapshot(analyst(), 2099, crypto.randomUUID());

    expect(built).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'fy-not-started' } },
    });
  });

  it('S9 stops a build whose totals do not reconcile, naming the totals', async () => {
    resetReleasesMock('reconciliation-failed');

    const built = await buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID());

    expect(built).toMatchObject({
      ok: false,
      error: {
        kind: 'problem',
        problem: {
          status: 409,
          code: 'reconciliation-failed',
          mismatches: ['national.all.declared', 'national.final.declared'],
        },
      },
    });
    const list = await listOpenDataReleases(analyst());
    expect(list.ok && list.data.some((r) => r.fy === 2026)).toBe(false);
  });
});

describe('S6 loadOpenDataRelease', () => {
  async function preview2026() {
    const built = await buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID());
    if (!built.ok) throw new Error('build failed');
    const detail = await loadOpenDataRelease(analyst(), built.data.id);
    if (!detail.ok) throw new Error('load failed');
    return detail.data;
  }

  it('reads the preview with who built it, its source and its six tables', async () => {
    const detail = await preview2026();

    expect(detail.release.status).toBe('preview');
    expect(detail.builtBy).toEqual({ subject: 'user-brian-otieno', name: 'Brian Otieno' });
    expect(detail.source).toEqual({ kind: 'live-projections', nationalReportReference: null });
    expect(Object.keys(detail.tables)).toEqual([
      'filing-by-commission',
      'compliance-by-commission',
      'by-entity-type',
      'by-cycle',
      'access-requests',
      'national-totals',
    ]);
  });

  it('S4 suppresses a cycle over fewer than 10 officers, and another so it cannot be worked out', async () => {
    const { tables } = await preview2026();
    const kisii = tables['filing-by-commission'].rows.filter((row) => row.commission === 'cpsb045');

    // Final: 3 officers. Its row total would reveal it, so the next smallest figure goes too.
    expect(kisii.find((row) => row.cycle === 'final')).toMatchObject({
      suppressed: true,
      filed: null,
      expected: null,
    });
    expect(kisii.filter((row) => row.suppressed).length).toBeGreaterThanOrEqual(2);
    expect(tables['filing-by-commission'].suppression).toMatchObject({ threshold: 10 });
    expect(tables['filing-by-commission'].suppression.cellsSuppressed).toBeGreaterThan(0);
  });

  it('marks access requests as not collected, never as zero', async () => {
    const { tables } = await preview2026();

    expect(tables['access-requests'].notCollected).toEqual(['received', 'granted', 'declined']);
    expect(tables['access-requests'].rows[0]).toMatchObject({ received: null, suppressed: false });
  });

  it("gives the national totals the reconciliation line reads: 2026's filed of expected", async () => {
    const { tables } = await preview2026();
    const value = (measure: string) =>
      tables['national-totals'].rows.find((row) => row.measure === measure)?.value;

    // Every Commission's live initial and final counts (no biennial cycle yet).
    expect(value('expected')).toBe(10_947);
    expect(value('filed')).toBe(9_760);
  });

  it('answers 404 for a release that does not exist', async () => {
    const detail = await loadOpenDataRelease(analyst(), crypto.randomUUID());

    expect(detail).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('reads a row that is not what was built as a failed load, never as a figure', async () => {
    const drifted = mockReportingClient(['eacc-analyst'], {
      tenant: 'eacc',
      fetch: async (request) => {
        const response = await mockReportingFetch(request);
        if (!/releases\/[^/]+$/.exec(new URL(request.url).pathname)) return response;
        const body = (await response.json()) as { tables: Record<string, { rows: unknown[] }> };
        const byCycle = body.tables['by-cycle'];
        if (byCycle) byCycle.rows[0] = { cycle: 'all', filed: 'many' };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const list = await listOpenDataReleases(drifted);
    const id = list.ok ? list.data[0]?.id : undefined;

    expect(await loadOpenDataRelease(drifted, id ?? '')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });
});
