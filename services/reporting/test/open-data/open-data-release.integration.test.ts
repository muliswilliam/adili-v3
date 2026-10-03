import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { openDataFiles, openDataReleases } from '../../src/db/schema.js';
import {
  buildLiveAggregates,
  type NationalAggregates,
} from '../../src/national-reports/aggregates.js';
import { OPEN_DATA_RELEASE_BUILT } from '../../src/open-data/events.js';
import { sha256 } from '../../src/open-data/files.js';
import { NcrNotApproved, OpenDataReleaseBuilder } from '../../src/open-data/release-builder.js';
import type { OpenDataReleaseView } from '../../src/open-data/representation.js';
import {
  buildReleaseTables,
  OPEN_DATA_TABLES,
  type OpenDataTable,
} from '../../src/open-data/tables.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { section } from '../support/receipts.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import {
  RELEASE_COMMISSIONS,
  RELEASE_COMPLIANCE,
  RELEASE_COUNTS,
  RELEASE_FY,
} from './release-fixtures.js';
import { givenProjectedYear, givenReleaseYear, givenReportSubmitted } from './release-year.js';

/**
 * S4, S6 (the snapshot build) and S9 through the HTTP API against Postgres, with the open-data
 * bucket faked. FY 2027: four Commissions reported (one late), jsc did not; the projection facts
 * hold the year's determinations, clarifications, actions and referrals, and some of other years
 * or not counted. An EACC analyst or supervisor builds a snapshot of the year from its national
 * consolidated report: a `preview` release, version 1 then 2, its twelve table files and the
 * release JSON in the bucket with the SHA-256 recorded, the tables suppressed, and
 * `open-data.release.built.v1` with ids only. The release is the NCR's frozen aggregates: a report
 * submitted since the NCR was built changes nothing until the NCR is rebuilt. Before the year has
 * an NCR (mid-year), a snapshot is built from the live projections. Access requests are published
 * as not collected. The authorisation rows of the matrix.
 */
describe('Open-data release snapshot build (S4, S6, S9)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = { sub: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
  const SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
  };
  const COMMISSION_ADMIN: Caller = { sub: 'admin-psc', tenant: 'psc', roles: ['commission-admin'] };
  /** EACC's role held for another tenant: not an EACC account. */
  const ANALYST_OF_PSC: Caller = { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] };

  const RELEASES = '/v1/eacc/open-data/releases';
  const NCR = `/v1/eacc/national-reports/${String(RELEASE_FY)}`;
  const BUILT_AT = '2028-08-20T07:00:00.000Z';

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    for (const slug of RELEASE_COMMISSIONS) api.directory.givenCommission(slug);
    api.clock.set(BUILT_AT);
  });

  const givenSubmitted = (tenant: string, counts: ReportCounts) =>
    givenReportSubmitted(api, tenant, counts);
  const givenTheYear = () => givenReleaseYear(api);

  /** The year's NCR, built by an EACC analyst; its aggregates. */
  async function ncrBuilt(): Promise<NationalAggregates> {
    const response = await api.send('POST', `${NCR}/build`, ANALYST);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ aggregates: NationalAggregates }>().aggregates;
  }

  function buildSnapshot(caller: Caller, key: string = randomUUID(), fy = RELEASE_FY) {
    return api.send('POST', RELEASES, caller, { fy }, { 'idempotency-key': key });
  }

  async function snapshotBuilt(caller: Caller = ANALYST): Promise<OpenDataReleaseView> {
    const response = await buildSnapshot(caller);
    expect(response.statusCode, response.body).toBe(202);
    return response.json<OpenDataReleaseView>();
  }

  function stored(releaseId: string, file: string): Buffer {
    const object = api.files.objects.get(`releases/${releaseId}/${file}`);
    if (!object) throw new Error(`No ${file} stored for ${releaseId}`);
    return object.body;
  }

  it('S6: an eacc-analyst builds a snapshot as a preview: files with their hashes, and the event without figures', async () => {
    await givenTheYear();
    await ncrBuilt();

    const release = await snapshotBuilt(ANALYST);

    expect(contractErrors(okResponse(RELEASES, 'post', 202), release)).toEqual([]);
    expect(release).toMatchObject({
      fy: RELEASE_FY,
      kind: 'snapshot',
      version: 1,
      status: 'preview',
      builtAt: BUILT_AT,
      publishedAt: null,
      withdrawnAt: null,
      withdrawnReason: null,
      manifestVerificationId: null,
    });
    expect(release.tables.map((table) => table.table)).toEqual([...OPEN_DATA_TABLES]);
    expect(release.tables.find((table) => table.table === 'filing-by-commission')?.rows).toBe(20);

    // Twelve table files and the release JSON, each stored with the hash the release records.
    expect(api.files.objects.size).toBe(13);
    for (const table of release.tables) {
      expect(sha256(stored(release.id, `${table.table}.json`))).toBe(table.sha256Json);
      expect(sha256(stored(release.id, `${table.table}.csv`))).toBe(table.sha256Csv);
    }
    expect(api.files.objects.get(`releases/${release.id}/by-cycle.csv`)?.contentType).toBe(
      'text/csv; charset=utf-8',
    );
    const releaseJson = JSON.parse(stored(release.id, 'release.json').toString('utf8')) as {
      tables: unknown;
    };
    expect(releaseJson).toEqual({
      id: release.id,
      fy: RELEASE_FY,
      kind: 'snapshot',
      version: 1,
      builtAt: BUILT_AT,
      source: 'national-report',
      ncrReference: null,
      suppression: { threshold: 10 },
      tables: release.tables,
    });
    const files = await api.asPlatform((tx) =>
      tx.select().from(openDataFiles).where(eq(openDataFiles.releaseId, release.id)),
    );
    expect(files).toHaveLength(13);
    expect(files.find((file) => file.table === 'release')).toMatchObject({
      format: 'json',
      objectKey: `releases/${release.id}/release.json`,
      sha256: sha256(stored(release.id, 'release.json')),
    });
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(openDataReleases).where(eq(openDataReleases.id, release.id)),
    );
    expect(row).toMatchObject({ builtBy: ANALYST.sub, status: 'preview' });

    // Ids, year, kind and version only: never a figure.
    expect(await api.events(OPEN_DATA_RELEASE_BUILT)).toEqual([
      expect.objectContaining({
        type: OPEN_DATA_RELEASE_BUILT,
        tenant: 'eacc',
        subject: release.id,
        data: { releaseId: release.id, fy: RELEASE_FY, kind: 'snapshot', version: 1 },
      }),
    ]);
  });

  it('S4: the stored tables are built from the NCR and the year’s facts, with suppression applied', async () => {
    await givenTheYear();
    const aggregates = await ncrBuilt();

    const release = await snapshotBuilt();

    // The facts the release counts are exactly the year's: other years, unknown outcomes, open
    // clarifications and unissued actions are left out, and jsc's (not reported) count nowhere.
    const expected = buildReleaseTables({ aggregates, compliance: RELEASE_COMPLIANCE }).tables;
    for (const table of OPEN_DATA_TABLES) {
      const body = JSON.parse(stored(release.id, `${table}.json`).toString('utf8')) as unknown;
      expect(body, table).toEqual(expected[table]);
      expect(
        contractErrors(
          okResponse('/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}', 'get'),
          body,
        ),
      ).toEqual([]);
    }
    const filing = expected['filing-by-commission'].rows;
    expect(filing.find((row) => row.commission === 'psc' && row.cycle === 'final')).toMatchObject({
      filed: null,
      suppressed: true,
    });
    expect(
      stored(release.id, 'access-requests.csv').toString('utf8').split('\r\n').slice(0, 3),
    ).toEqual([
      'commission,commissionName,received,granted,declined,_suppressed',
      'jsc,Judicial Service Commission,,,,false',
      'nlc,NLC Commission,,,,false',
    ]);
  });

  it('S4: access requests are published as not collected: null, unsuppressed, named in notCollected', async () => {
    await givenTheYear();
    await ncrBuilt();

    const release = await snapshotBuilt();

    const access = JSON.parse(
      stored(release.id, 'access-requests.json').toString('utf8'),
    ) as OpenDataTable;
    expect(access.notCollected).toEqual(['received', 'granted', 'declined']);
    expect(access.suppression.cellsSuppressed).toBe(0);
    // psc filed 3 received, 2 granted, 1 declined on its Form M: placeholders, not data.
    expect(access.rows.find((row) => row.commission === 'psc')).toEqual({
      commission: 'psc',
      commissionName: 'Public Service Commission',
      received: null,
      granted: null,
      declined: null,
      suppressed: false,
    });
    expect(stored(release.id, 'access-requests.csv').toString('utf8').split('\r\n')).toContain(
      'psc,Public Service Commission,,,,false',
    );
    const totals = JSON.parse(
      stored(release.id, 'national-totals.json').toString('utf8'),
    ) as OpenDataTable;
    expect(totals.notCollected).toEqual([
      'accessRequestsReceived',
      'accessRequestsGranted',
      'accessRequestsDeclined',
    ]);
    expect(totals.rows.filter((row) => totals.notCollected.includes(String(row.measure)))).toEqual([
      { measure: 'accessRequestsReceived', value: null, suppressed: false },
      { measure: 'accessRequestsGranted', value: null, suppressed: false },
      { measure: 'accessRequestsDeclined', value: null, suppressed: false },
    ]);
    const filing = JSON.parse(
      stored(release.id, 'filing-by-commission.json').toString('utf8'),
    ) as OpenDataTable;
    expect(filing.notCollected).toEqual([]);
    expect(
      contractErrors(
        okResponse('/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}', 'get'),
        access,
      ),
    ).toEqual([]);
  });

  it('S6: a supervisor builds the next version; both list for EACC, the latest first', async () => {
    await givenTheYear();
    await ncrBuilt();
    const first = await snapshotBuilt(ANALYST);

    api.clock.set('2028-09-01T07:00:00.000Z');
    const second = await snapshotBuilt(SUPERVISOR);

    expect(second).toMatchObject({
      version: 2,
      status: 'preview',
      builtAt: '2028-09-01T07:00:00.000Z',
    });
    // The same aggregates give the same files.
    expect(second.tables).toEqual(first.tables);

    for (const caller of [ANALYST, SUPERVISOR]) {
      const response = await api.get(RELEASES, caller);
      expect(response.statusCode, response.body).toBe(200);
      const releases = response.json<OpenDataReleaseView[]>();
      expect(contractErrors(okResponse(RELEASES, 'get'), releases)).toEqual([]);
      expect(releases.map((release) => [release.id, release.version])).toEqual([
        [second.id, 2],
        [first.id, 1],
      ]);
    }
  });

  it('S6: a retry with the same Idempotency-Key replays the build', async () => {
    await givenTheYear();
    await ncrBuilt();
    const key = randomUUID();

    const first = await buildSnapshot(ANALYST, key);
    const again = await buildSnapshot(ANALYST, key);

    expect(again.statusCode, again.body).toBe(202);
    expect(again.json()).toEqual(first.json());
    expect(await api.events(OPEN_DATA_RELEASE_BUILT)).toHaveLength(1);
    expect((await buildSnapshot(ANALYST, undefined, RELEASE_FY)).statusCode).toBe(202);
    const missingKey = await api.send('POST', RELEASES, ANALYST, { fy: RELEASE_FY });
    expect(missingKey.statusCode).toBe(400);
  });

  it('S9: a report submitted after the NCR was built leaves the snapshot equal to the NCR; a rebuild takes it in', async () => {
    await givenTheYear();
    const aggregates = await ncrBuilt();
    // jsc reports after the NCR was built.
    await givenSubmitted('jsc', {
      initial: section(30, 30),
      biennial: { ...section(0, 0), noCycleInPeriod: true },
      final: section(10, 9),
      clarifications: 0,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    });

    const release = await snapshotBuilt();

    // Built from the NCR's frozen aggregates: jsc is still not reported.
    const expected = buildReleaseTables({ aggregates, compliance: RELEASE_COMPLIANCE }).tables;
    for (const table of OPEN_DATA_TABLES) {
      expect(JSON.parse(stored(release.id, `${table}.json`).toString('utf8')), table).toEqual(
        expected[table],
      );
    }
    const value = (releaseId: string, measure: string) =>
      (
        JSON.parse(stored(releaseId, 'national-totals.json').toString('utf8')) as OpenDataTable
      ).rows.find((row) => row.measure === measure)?.value;
    expect(value(release.id, 'commissionsNotReported')).toBe(1);
    expect(value(release.id, 'expected')).toBe(aggregates.national.all.expected);

    // Rebuilt from the reports as they are now, the NCR and the next release take jsc in.
    const rebuilt = await ncrBuilt();
    const next = await snapshotBuilt();
    expect(next).toMatchObject({ version: 2 });
    expect(value(next.id, 'commissionsNotReported')).toBe(0);
    expect(value(next.id, 'expected')).toBe(rebuilt.national.all.expected);
    expect(rebuilt.national.all.expected).toBe(aggregates.national.all.expected + 40);
  });

  it('S9: the release national totals equal the NCR totals', async () => {
    await givenTheYear();
    const aggregates = await ncrBuilt();

    const release = await snapshotBuilt();

    const totals = JSON.parse(stored(release.id, 'national-totals.json').toString('utf8')) as {
      rows: { measure: string; value: number | null }[];
    };
    const value = (measure: string) => totals.rows.find((row) => row.measure === measure)?.value;
    expect(value('expected')).toBe(aggregates.national.all.expected);
    expect(value('filed')).toBe(aggregates.national.all.declared);
    expect(value('nonFilers')).toBe(aggregates.national.all.notDeclared);
    expect(value('filingRate')).toBe(aggregates.national.all.rate);
    expect(value('clarificationsIssued')).toBe(aggregates.national.clarifications);
    // Not collected yet: null, whatever the Form Ms carry.
    expect(value('accessRequestsReceived')).toBeNull();
    expect(value('commissionsReportedLate')).toBe(aggregates.reporting.late);
  });

  it('S6: a mid-year snapshot of a year in progress is built from the live projections, reconciled with them, and published deliberately', async () => {
    // February 2028: FY 2027 is in progress, no report is due and no NCR is built.
    api.clock.set('2028-02-15T07:00:00.000Z');
    await givenProjectedYear(api);

    const release = await snapshotBuilt(SUPERVISOR);

    expect(contractErrors(okResponse(RELEASES, 'post', 202), release)).toEqual([]);
    expect(release).toMatchObject({
      fy: RELEASE_FY,
      kind: 'snapshot',
      version: 1,
      status: 'preview',
    });
    const releaseJson = JSON.parse(stored(release.id, 'release.json').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(releaseJson).toMatchObject({ source: 'live-projections', ncrReference: null });
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(openDataReleases).where(eq(openDataReleases.id, release.id)),
    );
    expect(row?.nationalReportId).toBeNull();

    // The tables are those of every Commission's Form M as it would compile now: the
    // obligations and clarifications of the year (cancelled and other years' aside), over the
    // directory's Commissions, none reported yet; jsc has no obligations, so zeros.
    const jsc: ReportCounts = {
      initial: section(0, 0),
      biennial: { ...section(0, 0), noCycleInPeriod: true },
      final: section(0, 0),
      clarifications: 1,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    };
    const live = buildLiveAggregates({
      fy: RELEASE_FY,
      commissions: await api.directory.listCommissions(),
      counts: new Map([...Object.entries(RELEASE_COUNTS), ['jsc', jsc]]),
      receipts: [],
    });
    const expected = buildReleaseTables({
      aggregates: live,
      compliance: RELEASE_COMPLIANCE,
    }).tables;
    for (const table of OPEN_DATA_TABLES) {
      expect(JSON.parse(stored(release.id, `${table}.json`).toString('utf8')), table).toEqual(
        expected[table],
      );
    }
    const filing = expected['filing-by-commission'].rows;
    expect(filing.find((each) => each.commission === 'tsc' && each.cycle === 'all')).toMatchObject({
      reportStatus: 'not-reported',
      expected: 235,
      filed: 182,
      suppressed: false,
    });
    // Suppression as for an annual release: psc's final cell (4 officers) and its complement.
    expect(
      filing.find((each) => each.commission === 'psc' && each.cycle === 'final'),
    ).toMatchObject({
      filed: null,
      suppressed: true,
    });
    const national = (measure: string) =>
      expected['national-totals'].rows.find((each) => each.measure === measure)?.value;
    // S9: the national totals are the live projections' own.
    expect(national('expected')).toBe(live.national.all.expected);
    expect(national('filed')).toBe(live.national.all.declared);
    expect(national('clarificationsIssued')).toBe(live.national.clarifications);
    expect(national('commissionsReported')).toBe(0);

    // An EACC supervisor publishes it deliberately: public, with no NCR reference.
    const published = await api.send('POST', `${RELEASES}/${release.id}/publish`, SUPERVISOR);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published' });
    expect(
      api.documents.issued.find((each) => each.type === 'open-data-manifest')?.payload,
    ).toMatchObject({ kind: 'snapshot', ncrReference: null });
  });

  it('S6: once the year’s NCR is built, a snapshot is built from it, not the live projections', async () => {
    await givenTheYear();
    await givenProjectedYear(api);
    await ncrBuilt();

    const release = await snapshotBuilt();

    const releaseJson = JSON.parse(stored(release.id, 'release.json').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(releaseJson).toMatchObject({ source: 'national-report' });
    const filing = JSON.parse(
      stored(release.id, 'filing-by-commission.json').toString('utf8'),
    ) as OpenDataTable;
    expect(
      filing.rows.find((row) => row.commission === 'tsc' && row.cycle === 'all'),
    ).toMatchObject({
      reportStatus: 'submitted-late',
    });
  });

  it('409 fy-not-started for a snapshot of a year that has not started; 503 while the directory is down', async () => {
    api.clock.set('2027-06-30T07:00:00.000Z');

    const early = await buildSnapshot(ANALYST);
    expect(early.statusCode, early.body).toBe(409);
    expect(early.json()).toMatchObject({ code: 'fy-not-started' });

    api.clock.set('2028-02-15T07:00:00.000Z');
    api.directory.failCalls(1);
    const down = await buildSnapshot(ANALYST);
    expect(down.statusCode, down.body).toBe(503);
    expect(down.json()).toMatchObject({ type: 'directory-unavailable' });
    expect(await api.asPlatform((tx) => tx.select().from(openDataReleases))).toEqual([]);
  });

  it('503 while object storage cannot be reached, and nothing is recorded', async () => {
    await givenTheYear();
    await ncrBuilt();
    api.files.failCalls(1);

    const response = await buildSnapshot(ANALYST);

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ type: 'storage-unavailable' });
    expect(await api.asPlatform((tx) => tx.select().from(openDataReleases))).toEqual([]);
    expect(await api.events(OPEN_DATA_RELEASE_BUILT)).toEqual([]);
  });

  it('the builder: an annual release needs the approved NCR; a release id already built is returned as it is', async () => {
    await givenTheYear();
    await ncrBuilt();
    const builder = api.app.get(OpenDataReleaseBuilder);

    await expect(
      builder.build({ fy: RELEASE_FY, kind: 'annual', builtBy: null }),
    ).rejects.toBeInstanceOf(NcrNotApproved);

    const releaseId = uuidv7();
    const first = await builder.build({
      fy: RELEASE_FY,
      kind: 'snapshot',
      builtBy: null,
      releaseId,
    });
    const retried = await builder.build({
      fy: RELEASE_FY,
      kind: 'snapshot',
      builtBy: null,
      releaseId,
    });
    expect(retried).toEqual(first);
    expect(first.id).toBe(releaseId);
    expect(await api.events(OPEN_DATA_RELEASE_BUILT)).toHaveLength(1);
  });

  it('authorisation: only EACC analysts and supervisors build and list releases', async () => {
    await givenTheYear();
    await ncrBuilt();

    for (const caller of [COMMISSION_ADMIN, ANALYST_OF_PSC]) {
      expect((await buildSnapshot(caller)).statusCode).toBe(403);
      expect((await api.get(RELEASES, caller)).statusCode).toBe(403);
    }
    expect(await api.asPlatform((tx) => tx.select().from(openDataReleases))).toEqual([]);

    // A Commission's row-level security context sees no release.
    await snapshotBuilt();
    const visible = await api.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant', 'psc', true)`);
      return tx.select().from(openDataReleases);
    });
    expect(visible).toEqual([]);
  });

  it('400 for a body that is not a financial year and a kind', async () => {
    for (const body of [
      {},
      { fy: 2024 },
      { fy: '2027' },
      { fy: 2027, kind: 'interim' },
      { fy: 2027, kind: null },
      { fy: 2027, by: 'me' },
    ]) {
      const response = await api.send('POST', RELEASES, ANALYST, body, {
        'idempotency-key': randomUUID(),
      });
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});
