import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildOpenDataRelease,
  buildOpenDataSnapshot,
  listOpenDataReleases,
  loadOpenDataRelease,
  publishOpenDataRelease,
  withdrawOpenDataRelease,
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
const supervisor = () => eacc(['eacc-supervisor'], 'Esther Chebet');

/** FY 2025/2026 snapshot v2, published (the `history` seed). */
const PUBLISHED_V2 = '0199c000-0000-7000-8000-000000000002';
/** FY 2025/2026 snapshot v1, withdrawn. */
const WITHDRAWN_V1 = '0199c000-0000-7000-8000-000000000001';

async function built2026() {
  const built = await buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID());
  if (!built.ok) throw new Error('build failed');
  return built.data;
}

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

describe('S6 publishOpenDataRelease', () => {
  it('publishes a preview as the supervisor, with its manifest issued', async () => {
    const preview = await built2026();

    const published = await publishOpenDataRelease(supervisor(), preview.id, crypto.randomUUID());

    expect(published).toMatchObject({
      ok: true,
      data: {
        id: preview.id,
        status: 'published',
        publishedBy: { name: 'Esther Chebet' },
        publishedAt: expect.any(String) as unknown,
        manifestVerificationId: expect.stringMatching(/^ADL-/) as unknown,
      },
    });
  });

  it('refuses an analyst with 403, and the release stays a preview', async () => {
    const preview = await built2026();

    const refused = await publishOpenDataRelease(analyst(), preview.id, crypto.randomUUID());

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
    const detail = await loadOpenDataRelease(analyst(), preview.id);
    expect(detail.ok && detail.data.release.status).toBe('preview');
  });

  it('refuses a release that is not a preview (`release-not-preview`)', async () => {
    const refused = await publishOpenDataRelease(supervisor(), PUBLISHED_V2, crypto.randomUUID());

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'release-not-preview' } },
    });
  });

  it('refuses an annual preview while the year has a published annual release', async () => {
    resetNcrMock('approved');
    // The annual release published on approval is withdrawn; v2 and v3 are built as previews and
    // v2 is published: v3 cannot be, while v2 is.
    const list = await listOpenDataReleases(analyst());
    const annual = list.ok ? list.data.find((r) => r.kind === 'annual') : undefined;
    if (!annual) throw new Error('no annual release');
    await withdrawOpenDataRelease(supervisor(), annual.id, 'Wrong totals.', crypto.randomUUID());
    const v2 = await buildOpenDataRelease(supervisor(), 2025, 'annual', crypto.randomUUID());
    const v3 = await buildOpenDataRelease(supervisor(), 2025, 'annual', crypto.randomUUID());
    if (!v2.ok || !v3.ok) throw new Error('build failed');
    await publishOpenDataRelease(supervisor(), v2.data.id, crypto.randomUUID());

    const refused = await publishOpenDataRelease(supervisor(), v3.data.id, crypto.randomUUID());

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'annual-release-published' } },
    });
  });

  it('answers 404 for a release that does not exist', async () => {
    expect(
      await publishOpenDataRelease(supervisor(), crypto.randomUUID(), crypto.randomUUID()),
    ).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('publishes nothing when documents cannot be reached (503 `documents-unavailable`)', async () => {
    const preview = await built2026();
    resetReleasesMock('documents-unavailable', { keep: true });

    expect(
      await publishOpenDataRelease(supervisor(), preview.id, crypto.randomUUID()),
    ).toMatchObject({
      ok: false,
      error: { kind: 'unavailable', problemType: 'documents-unavailable' },
    });
    const detail = await loadOpenDataRelease(analyst(), preview.id);
    expect(detail.ok && detail.data.release.status).toBe('preview');
  });
});

describe('S7 withdrawOpenDataRelease', () => {
  it('withdraws a published release with the reason, trimmed, by the supervisor', async () => {
    const withdrawn = await withdrawOpenDataRelease(
      supervisor(),
      PUBLISHED_V2,
      '  The Nyeri board was left out.  ',
      crypto.randomUUID(),
    );

    expect(withdrawn).toMatchObject({
      ok: true,
      data: {
        status: 'withdrawn',
        withdrawnBy: { name: 'Esther Chebet' },
        withdrawnReason: 'The Nyeri board was left out.',
        withdrawnAt: expect.any(String) as unknown,
        // Still the published one, still in the history.
        publishedBy: { name: 'Esther Chebet' },
      },
    });
  });

  it('refuses an analyst with 403', async () => {
    expect(
      await withdrawOpenDataRelease(analyst(), PUBLISHED_V2, 'Wrong.', crypto.randomUUID()),
    ).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('refuses an empty reason with 400', async () => {
    expect(
      await withdrawOpenDataRelease(supervisor(), PUBLISHED_V2, '   ', crypto.randomUUID()),
    ).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400 } },
    });
  });

  it('refuses a release that is not published (`release-not-published`)', async () => {
    expect(
      await withdrawOpenDataRelease(supervisor(), WITHDRAWN_V1, 'Again.', crypto.randomUUID()),
    ).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'release-not-published' } },
    });
  });

  it('a new build after a withdrawal is the next version of its kind', async () => {
    resetNcrMock('draft');
    await withdrawOpenDataRelease(supervisor(), PUBLISHED_V2, 'Wrong.', crypto.randomUUID());

    const rebuilt = await buildOpenDataRelease(analyst(), 2025, 'snapshot', crypto.randomUUID());

    expect(rebuilt).toMatchObject({ ok: true, data: { version: 3, status: 'preview' } });
  });
});

describe('S7 version history', () => {
  it('reads a release with every version of its year and kind, the latest first', async () => {
    const detail = await loadOpenDataRelease(analyst(), WITHDRAWN_V1);

    expect(detail.ok && detail.data.versions?.map((r) => [r.version, r.status])).toEqual([
      [2, 'published'],
      [1, 'withdrawn'],
    ]);
  });

  it('leaves out the other kind and other years', async () => {
    resetNcrMock('approved');

    const detail = await loadOpenDataRelease(analyst(), PUBLISHED_V2);

    expect(detail.ok && detail.data.versions?.every((r) => r.kind === 'snapshot')).toBe(true);
  });
});

describe('Idempotency-Key on publish and withdraw', () => {
  it('replays a publish retried with the same key instead of refusing it as published', async () => {
    const preview = await built2026();
    const key = crypto.randomUUID();
    const first = await publishOpenDataRelease(supervisor(), preview.id, key);

    const again = await publishOpenDataRelease(supervisor(), preview.id, key);

    expect(again).toEqual(first);
    expect(again.ok).toBe(true);
  });

  it('replays a stored refusal too', async () => {
    const key = crypto.randomUUID();
    await publishOpenDataRelease(supervisor(), PUBLISHED_V2, key);

    expect(await publishOpenDataRelease(supervisor(), PUBLISHED_V2, key)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'release-not-preview' } },
    });
  });

  it('answers 422 to the same key with a different reason', async () => {
    const key = crypto.randomUUID();
    await withdrawOpenDataRelease(supervisor(), PUBLISHED_V2, 'Wrong.', key);

    expect(
      await withdrawOpenDataRelease(supervisor(), PUBLISHED_V2, 'Something else.', key),
    ).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 422, type: 'idempotency-key-reused' } },
    });
  });

  it('answers 409 `idempotency-key-in-use` while the first request with the key runs', async () => {
    const preview = await built2026();
    const key = crypto.randomUUID();

    const [first, second] = await Promise.all([
      publishOpenDataRelease(supervisor(), preview.id, key),
      publishOpenDataRelease(supervisor(), preview.id, key),
    ]);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, type: 'idempotency-key-in-use' } },
    });
  });

  it('takes any key of 1 to 255 characters, as api-kit does, and refuses a longer one', async () => {
    const preview = await built2026();

    expect(await publishOpenDataRelease(supervisor(), preview.id, 'x'.repeat(256))).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400, type: 'idempotency-key-missing' } },
    });
    expect(await publishOpenDataRelease(supervisor(), preview.id, 'retry-1')).toMatchObject({
      ok: true,
      data: { status: 'published' },
    });
  });

  it('does not store a 5xx: a retry with the key runs again', async () => {
    const preview = await built2026();
    const key = crypto.randomUUID();
    resetReleasesMock('documents-unavailable', { keep: true });
    await publishOpenDataRelease(supervisor(), preview.id, key);
    resetReleasesMock('history', { keep: true });

    expect(await publishOpenDataRelease(supervisor(), preview.id, key)).toMatchObject({
      ok: true,
      data: { status: 'published' },
    });
  });
});
