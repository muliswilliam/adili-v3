import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { complianceReports, openDataReleases, reportReceipts } from '../../src/db/schema.js';
import type { CommissionOpenDataPreview } from '../../src/open-data/commission-preview.js';
import type { OpenDataReleaseView } from '../../src/open-data/representation.js';
import type { ReleaseStatus } from '../../src/open-data/schema.js';
import type { OpenDataTable } from '../../src/open-data/tables.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { RELEASE_COMMISSIONS, RELEASE_COUNTS, RELEASE_FY } from './release-fixtures.js';

/**
 * S6 (a commission-admin sees its own rows of the preview) through the HTTP API against Postgres,
 * with the open-data bucket faked. FY 2027 as in the release fixtures: an EACC analyst builds a
 * snapshot, and a commission-admin reads its own Commission's rows of the current release, with
 * suppression as stored; never another Commission's rows nor the national tables. The release
 * shown is the last built preview or published release of the most recent year; withdrawn ones
 * are skipped. Published and withdrawn statuses are arranged directly (publishing is #352's).
 */
describe('Commission open-data preview (S6)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = { sub: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
  const PSC_ADMIN: Caller = { sub: 'admin-psc', tenant: 'psc', roles: ['commission-admin'] };
  const WRC_ADMIN: Caller = { sub: 'admin-wrc', tenant: 'wrc', roles: ['commission-admin'] };
  const PSC_SUPERVISOR: Caller = { sub: 'sup-psc', tenant: 'psc', roles: ['supervisor'] };
  const PSC_OFFICER: Caller = { sub: 'ro-psc', tenant: 'psc', roles: ['reporting-officer'] };

  const RELEASES = '/v1/eacc/open-data/releases';
  const NCR = `/v1/eacc/national-reports/${String(RELEASE_FY)}`;
  const PREVIEW = '/v1/commissions/{slug}/open-data/preview';
  const previewOf = (slug: string) => `/v1/commissions/${slug}/open-data/preview`;

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    for (const slug of RELEASE_COMMISSIONS) api.directory.givenCommission(slug);
    api.clock.set('2028-08-20T07:00:00.000Z');
  });

  async function givenSubmitted(tenant: string, counts: ReportCounts): Promise<void> {
    const reportId = uuidv7();
    const values = {
      tenant,
      fy: RELEASE_FY,
      source: 'hosted' as const,
      reference: `RPT-${tenant.toUpperCase()}-2028-0000001-X`,
      submittedAt: new Date('2028-07-20T07:00:00.000Z'),
      late: false,
      counts,
    };
    await api.asPlatform(async (tx) => {
      await tx.insert(complianceReports).values({ id: reportId, status: 'submitted', ...values });
      await tx.insert(reportReceipts).values({ reportId, ...values });
    });
  }

  /** The year's reports submitted and its NCR built by an EACC analyst. */
  async function givenTheYearsNcr(): Promise<void> {
    for (const [tenant, counts] of Object.entries(RELEASE_COUNTS)) {
      await givenSubmitted(tenant, counts);
    }
    const response = await api.send('POST', `${NCR}/build`, ANALYST);
    expect(response.statusCode, response.body).toBe(200);
  }

  /** A snapshot built by an EACC analyst at `at`: a preview. */
  async function snapshotBuilt(at: string): Promise<OpenDataReleaseView> {
    api.clock.set(at);
    const response = await api.send(
      'POST',
      RELEASES,
      ANALYST,
      { fy: RELEASE_FY },
      { 'idempotency-key': randomUUID() },
    );
    expect(response.statusCode, response.body).toBe(202);
    return response.json<OpenDataReleaseView>();
  }

  /** Sets a release's status (and optionally year) as publishing or withdrawing it would. */
  async function given(
    releaseId: string,
    change: { status?: ReleaseStatus; fy?: number },
  ): Promise<void> {
    await api.asPlatform((tx) =>
      tx
        .update(openDataReleases)
        .set({
          ...change,
          ...(change.status === 'published'
            ? { publishedAt: new Date(), publishedBy: 'eacc-supervisor-1' }
            : {}),
          ...(change.status === 'withdrawn'
            ? { withdrawnAt: new Date(), withdrawnBy: 'eacc-supervisor-1', withdrawnReason: 'x' }
            : {}),
        })
        .where(eq(openDataReleases.id, releaseId)),
    );
  }

  function storedRows(releaseId: string, table: string): OpenDataTable['rows'] {
    const object = api.files.objects.get(`releases/${releaseId}/${table}.json`);
    if (!object) throw new Error(`No ${table} stored for ${releaseId}`);
    return (JSON.parse(object.body.toString('utf8')) as OpenDataTable).rows;
  }

  async function previewFor(
    caller: Caller,
    slug = caller.tenant ?? '',
  ): Promise<CommissionOpenDataPreview> {
    const response = await api.get(previewOf(slug), caller);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<CommissionOpenDataPreview>();
    expect(contractErrors(okResponse(PREVIEW, 'get'), body)).toEqual([]);
    return body;
  }

  it('S6: a commission-admin sees only its own rows of the preview, suppression as stored', async () => {
    await givenTheYearsNcr();
    const release = await snapshotBuilt('2028-08-20T07:00:00.000Z');

    const preview = await previewFor(PSC_ADMIN);

    expect(preview.release).toMatchObject({ id: release.id, status: 'preview', version: 1 });
    // The Commission tables only; the national ones never reach a Commission.
    expect(Object.keys(preview.tables)).toEqual([
      'filing-by-commission',
      'compliance-by-commission',
      'access-requests',
    ]);
    for (const [table, rows] of Object.entries(preview.tables)) {
      expect(rows.length, table).toBeGreaterThan(0);
      expect(rows, table).toEqual(
        storedRows(release.id, table).filter((row) => row.commission === 'psc'),
      );
    }
    expect(preview.tables['filing-by-commission']).toHaveLength(4);
    // psc's final cycle counts 4 officers: suppressed as released.
    expect(
      preview.tables['filing-by-commission'].find((row) => row.cycle === 'final'),
    ).toMatchObject({ filed: null, expected: null, suppressed: true });
    expect(
      preview.tables['filing-by-commission'].find((row) => row.cycle === 'biennial'),
    ).toMatchObject({ expected: 100, filed: 95, suppressed: false });

    // wrc counts 5 officers in all: its own rows, its counts suppressed (its biennial cycle is
    // a structural zero, published).
    const wrc = await previewFor(WRC_ADMIN);
    expect(
      new Set(
        Object.values(wrc.tables)
          .flat()
          .map((row) => row.commission),
      ),
    ).toEqual(new Set(['wrc']));
    expect(wrc.tables['filing-by-commission'].find((row) => row.cycle === 'all')).toMatchObject({
      filed: null,
      suppressed: true,
    });
    expect(wrc.tables['compliance-by-commission']).toEqual([
      expect.objectContaining({ suppressed: true }),
    ]);
    // Access requests are not collected yet: null, not suppressed.
    expect(wrc.tables['access-requests']).toEqual([
      expect.objectContaining({ received: null, suppressed: false }),
    ]);
  });

  it('S6: tenant isolation - another Commission, EACC and the national tables stay out of reach', async () => {
    await givenTheYearsNcr();
    await snapshotBuilt('2028-08-20T07:00:00.000Z');

    // Another Commission's preview, or EACC through the Commission route: 404, as if none existed.
    expect((await api.get(previewOf('tsc'), PSC_ADMIN)).statusCode).toBe(404);
    expect((await api.get(previewOf('psc'), ANALYST)).statusCode).toBe(404);
    // The Commission's other staff: 403.
    expect((await api.get(previewOf('psc'), PSC_SUPERVISOR)).statusCode).toBe(403);
    expect((await api.get(previewOf('psc'), PSC_OFFICER)).statusCode).toBe(403);

    const preview = await previewFor(PSC_ADMIN);
    expect(
      new Set(
        Object.values(preview.tables)
          .flat()
          .map((row) => row.commission),
      ),
    ).toEqual(new Set(['psc']));
  });

  it('S6: 404 before any release is built', async () => {
    const response = await api.get(previewOf('psc'), PSC_ADMIN);
    expect(response.statusCode).toBe(404);
  });

  it('S6: falls back to the latest published release when no preview is current; withdrawn ones are skipped', async () => {
    await givenTheYearsNcr();
    const first = await snapshotBuilt('2028-08-20T07:00:00.000Z');
    await given(first.id, { status: 'published' });

    // Only a published release: it is shown.
    expect((await previewFor(PSC_ADMIN)).release).toMatchObject({
      id: first.id,
      status: 'published',
    });

    // A preview built since: the current one.
    const second = await snapshotBuilt('2028-09-01T07:00:00.000Z');
    expect((await previewFor(PSC_ADMIN)).release).toMatchObject({
      id: second.id,
      status: 'preview',
      version: 2,
    });

    // The preview withdrawn (as a correction would): back to the published release.
    await given(second.id, { status: 'withdrawn' });
    expect((await previewFor(PSC_ADMIN)).release).toMatchObject({ id: first.id });

    // Every release withdrawn: nothing to preview.
    await given(first.id, { status: 'withdrawn' });
    expect((await api.get(previewOf('psc'), PSC_ADMIN)).statusCode).toBe(404);
  });

  it('S6: the most recent year wins, and a preview a later published release overtook is stale', async () => {
    await givenTheYearsNcr();
    const stale = await snapshotBuilt('2028-08-20T07:00:00.000Z');
    const published = await snapshotBuilt('2028-09-01T07:00:00.000Z');
    await given(published.id, { status: 'published' });

    // The preview built before the published release of the same year is not current.
    expect((await previewFor(PSC_ADMIN)).release).toMatchObject({ id: published.id });

    // A preview of an earlier year does not displace the latest year's published release.
    await given(stale.id, { fy: RELEASE_FY - 1 });
    expect((await previewFor(PSC_ADMIN)).release).toMatchObject({ id: published.id });

    // A preview of a later year does.
    await given(stale.id, { fy: RELEASE_FY + 1 });
    expect((await previewFor(PSC_ADMIN)).release).toMatchObject({
      id: stale.id,
      status: 'preview',
    });
  });

  it('S6: 503 storage-unavailable while the files cannot be read', async () => {
    await givenTheYearsNcr();
    await snapshotBuilt('2028-08-20T07:00:00.000Z');
    api.files.failReads(1);

    const response = await api.get(previewOf('psc'), PSC_ADMIN);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'storage-unavailable' });
  });
});
