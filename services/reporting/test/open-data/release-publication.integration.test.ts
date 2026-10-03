import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDataReleases, reportReceipts } from '../../src/db/schema.js';
import type { NationalAggregates } from '../../src/national-reports/aggregates.js';
import { nationalReportApprovalWorkflowId } from '../../src/national-reports/contract.js';
import {
  OPEN_DATA_RELEASE_BUILT,
  OPEN_DATA_RELEASE_PUBLISHED,
  OPEN_DATA_RELEASE_WITHDRAWN,
} from '../../src/open-data/events.js';
import { openDataReleaseWorkflowId } from '../../src/open-data/contract.js';
import { sha256 } from '../../src/open-data/files.js';
import { annualReleaseIdOf } from '../../src/open-data/release-workflows.js';
import type { OpenDataReleaseView } from '../../src/open-data/representation.js';
import type { OpenDataTable } from '../../src/open-data/tables.js';
import { OPEN_DATA_TABLES } from '../../src/open-data/tables.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { historyPayloads } from '../support/workflow-history.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { RELEASE_COMMISSIONS, RELEASE_FY } from './release-fixtures.js';
import { givenReleaseYear } from './release-year.js';

/**
 * S5, S6 (publish authorisation) and S7 through the HTTP API against Postgres and the compose
 * Temporal, with documents and the open-data bucket faked. FY 2027 as release-fixtures.ts has it.
 *
 * - S5: an EACC supervisor approves the year's NCR, and `OpenDataReleaseWorkflow` builds the annual
 *   release from its aggregates (reconciled; a report changed since does not hold it back), issues its manifest through documents as a Public document
 *   (tables, rows, hidden cells, hashes, version, year, kind) and publishes it, by the approver,
 *   with `open-data.release.built.v1` and `published.v1` carrying ids only.
 * - S6: an analyst's snapshot preview is published by an EACC supervisor only: an analyst and a
 *   Commission get 403. A documents outage publishes nothing.
 * - S7: a supervisor withdraws a published release with a reason: its manifest revoked through
 *   documents first (a documents outage withdraws nothing), then status, who, when and the
 *   reason, `withdrawn.v1`, the files still there; the next build is version 2. A withdrawn
 *   annual release is corrected by an annual build (analyst or supervisor), version 2, a preview
 *   published deliberately; never while an annual release of the year is published.
 */
describe('Open-data release publication (S5, S6, S7)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = {
    sub: 'eacc-analyst-1',
    tenant: 'eacc',
    roles: ['eacc-analyst'],
    name: 'Amina Hassan',
  };
  const SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
    name: 'Joseph Mwangi',
  };
  const COMMISSION_ADMIN: Caller = { sub: 'admin-psc', tenant: 'psc', roles: ['commission-admin'] };
  /** EACC's role held for another tenant: not an EACC account. */
  const SUPERVISOR_OF_PSC: Caller = { sub: 'odd-1', tenant: 'psc', roles: ['eacc-supervisor'] };

  const RELEASES = '/v1/eacc/open-data/releases';
  const NCR = `/v1/eacc/national-reports/${String(RELEASE_FY)}`;
  const BUILT_AT = '2028-08-20T07:00:00.000Z';
  const PUBLISHED_AT = '2028-08-25T08:00:00.000Z';
  const REASON = 'The TSC figures were filed against the wrong financial year.';

  /** Workflows a test started, ended before the next one. */
  const started: string[] = [];

  beforeAll(async () => {
    api = await startReportingApi();
    return async () => {
      await api.endWorkflows(started);
      await api.close();
    };
  });

  beforeEach(async () => {
    await api.endWorkflows(started.splice(0));
    await api.reset();
    for (const slug of RELEASE_COMMISSIONS) api.directory.givenCommission(slug);
    api.clock.set(BUILT_AT);
  });

  async function ncrBuilt(): Promise<{ id: string; aggregates: NationalAggregates }> {
    const response = await api.send('POST', `${NCR}/build`, ANALYST);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ id: string; aggregates: NationalAggregates }>();
  }

  async function snapshotBuilt(): Promise<OpenDataReleaseView> {
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

  const publish = (caller: Caller, releaseId: string) =>
    api.send('POST', `${RELEASES}/${releaseId}/publish`, caller);

  const withdraw = (caller: Caller, releaseId: string, body: unknown = { reason: REASON }) =>
    api.send('POST', `${RELEASES}/${releaseId}/withdraw`, caller, body);

  async function published(releaseId: string): Promise<OpenDataReleaseView> {
    api.clock.set(PUBLISHED_AT);
    const response = await publish(SUPERVISOR, releaseId);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<OpenDataReleaseView>();
  }

  async function releases(): Promise<OpenDataReleaseView[]> {
    const response = await api.get(RELEASES, ANALYST);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<OpenDataReleaseView[]>();
  }

  function storedTable(releaseId: string, table: string): OpenDataTable {
    const object = api.files.objects.get(`releases/${releaseId}/${table}.json`);
    if (!object) throw new Error(`No ${table} stored for ${releaseId}`);
    return JSON.parse(object.body.toString('utf8')) as OpenDataTable;
  }

  /** The manifest payload the release's files say it should have: rows, hidden cells, hashes. */
  function manifestTablesOf(release: OpenDataReleaseView) {
    return release.tables.map((entry) => ({
      ...entry,
      cellsSuppressed: storedTable(release.id, entry.table).suppression.cellsSuppressed,
    }));
  }

  const manifests = () => api.documents.issued.filter((each) => each.type === 'open-data-manifest');

  const build = (caller: Caller, body: unknown) =>
    api.send('POST', RELEASES, caller, body, { 'idempotency-key': randomUUID() });

  /**
   * The year's NCR (`ncr`, or built now) approved: its annual release built, certified and
   * published by the workflow.
   */
  async function annualPublished(built?: { id: string }): Promise<OpenDataReleaseView> {
    const ncr = built ?? (await ncrBuilt());
    api.clock.set(PUBLISHED_AT);
    const approved = await api.send('POST', `${NCR}/approve`, SUPERVISOR, undefined, {
      'idempotency-key': randomUUID(),
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const releaseId = annualReleaseIdOf(ncr.id);
    const workflowId = openDataReleaseWorkflowId({ releaseId, fy: RELEASE_FY, kind: 'annual' });
    started.push(workflowId, nationalReportApprovalWorkflowId(ncr.id));
    await api.temporal.workflow.getHandle(workflowId).result();
    const release = (await releases()).find((each) => each.id === releaseId);
    expect(release?.status).toBe('published');
    if (!release) throw new Error('no annual release');
    return release;
  }

  it('S5: approving the NCR publishes the annual release: built and reconciled, manifest issued as Public, by the approver, events without figures', async () => {
    await givenReleaseYear(api);
    const ncr = await ncrBuilt();

    api.clock.set(PUBLISHED_AT);
    const approved = await api.send('POST', `${NCR}/approve`, SUPERVISOR, undefined, {
      'idempotency-key': randomUUID(),
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const releaseId = annualReleaseIdOf(ncr.id);
    const workflowId = openDataReleaseWorkflowId({ releaseId, fy: RELEASE_FY, kind: 'annual' });
    started.push(workflowId, nationalReportApprovalWorkflowId(ncr.id));

    const result: unknown = await api.temporal.workflow.getHandle(workflowId).result();
    const [release] = await releases();
    expect(contractErrors(okResponse(RELEASES, 'get'), [release])).toEqual([]);
    expect(release).toMatchObject({
      id: releaseId,
      fy: RELEASE_FY,
      kind: 'annual',
      version: 1,
      status: 'published',
      builtAt: PUBLISHED_AT,
      publishedAt: PUBLISHED_AT,
      publishedBy: { subject: SUPERVISOR.sub, name: 'Joseph Mwangi' },
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawnReason: null,
    });
    if (!release) throw new Error('no release');
    expect(result).toEqual({
      releaseId,
      version: 1,
      documentId: release.manifestDocumentId,
      verificationId: release.manifestVerificationId,
    });
    expect(release.tables.map((table) => table.table)).toEqual([...OPEN_DATA_TABLES]);

    // The manifest: one Public document of EACC's about the release, its files' hashes as stored.
    const ncrReference = approved.json<{ reference: string }>().reference;
    expect(manifests()).toEqual([
      {
        type: 'open-data-manifest',
        templateVersion: 1,
        issuerTenant: 'eacc',
        subjectRef: `open-data-release:${releaseId}`,
        subjectPersonId: null,
        idempotencyKey: expect.any(String) as string,
        payload: {
          releaseId,
          financialYear: '2027/2028',
          kind: 'annual',
          version: 1,
          builtAt: PUBLISHED_AT,
          ncrReference,
          publishedBy: null,
          suppressionThreshold: 10,
          tables: manifestTablesOf(release),
          releaseSha256: sha256(
            api.files.objects.get(`releases/${releaseId}/release.json`)?.body ?? Buffer.alloc(0),
          ),
        },
      },
    ]);
    expect(manifests()[0]?.payload).toHaveProperty('tables.0.cellsSuppressed', expect.any(Number));
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(openDataReleases).where(eq(openDataReleases.id, releaseId)),
    );
    expect(row).toMatchObject({ builtBy: null, manifestDocumentId: release.manifestDocumentId });

    // The events: ids, the year, the kind and the version; no figure, no name.
    const ids = { releaseId, fy: RELEASE_FY, kind: 'annual', version: 1 };
    for (const type of [OPEN_DATA_RELEASE_BUILT, OPEN_DATA_RELEASE_PUBLISHED]) {
      expect(await api.events(type)).toEqual([
        expect.objectContaining({ tenant: 'eacc', subject: releaseId, data: ids }),
      ]);
    }
    const history = await historyPayloads(api.temporal, workflowId);
    expect(history).toContain(releaseId);
    for (const text of ['Joseph Mwangi', SUPERVISOR.sub, 'sha256', 'Public Service Commission']) {
      expect(history).not.toContain(text);
    }
  });

  it('S6: an eacc-supervisor publishes a snapshot preview: manifest with their name, published, event', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();

    const release = await published(preview.id);

    expect(contractErrors(okResponse(`${RELEASES}/{releaseId}/publish`, 'post'), release)).toEqual(
      [],
    );
    expect(release).toMatchObject({
      id: preview.id,
      kind: 'snapshot',
      version: 1,
      status: 'published',
      builtAt: BUILT_AT,
      publishedAt: PUBLISHED_AT,
      publishedBy: { subject: SUPERVISOR.sub, name: 'Joseph Mwangi' },
      tables: preview.tables,
    });
    expect(release.manifestDocumentId).toEqual(expect.any(String));
    expect(release.manifestVerificationId).toMatch(/^ADL-/);
    expect(manifests()).toEqual([
      expect.objectContaining({
        subjectRef: `open-data-release:${preview.id}`,
        payload: expect.objectContaining({
          kind: 'snapshot',
          version: 1,
          builtAt: BUILT_AT,
          // A snapshot of the NCR while a draft: no reference yet.
          ncrReference: null,
          publishedBy: 'Joseph Mwangi',
          tables: manifestTablesOf(preview),
        }) as unknown,
      }),
    ]);
    expect(await api.events(OPEN_DATA_RELEASE_PUBLISHED)).toEqual([
      expect.objectContaining({
        subject: preview.id,
        data: { releaseId: preview.id, fy: RELEASE_FY, kind: 'snapshot', version: 1 },
      }),
    ]);

    // Published once: publishing again is 409, and issues nothing more.
    const again = await publish(SUPERVISOR, preview.id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'release-not-preview' });
    expect(manifests()).toHaveLength(1);
  });

  it('S6: an eacc-analyst, a commission-admin and an EACC role of another tenant get 403 publishing; nothing is published', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();

    for (const caller of [ANALYST, COMMISSION_ADMIN, SUPERVISOR_OF_PSC]) {
      const response = await publish(caller, preview.id);
      expect(response.statusCode, caller.sub).toBe(403);
    }

    const [release] = await releases();
    expect(release).toMatchObject({
      status: 'preview',
      publishedBy: null,
      manifestDocumentId: null,
    });
    expect(manifests()).toEqual([]);
    expect(await api.events(OPEN_DATA_RELEASE_PUBLISHED)).toEqual([]);
  });

  it('S6: 503 while documents is down publishes nothing; publishing again issues the manifest once', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();

    api.documents.failCalls(1);
    const down = await publish(SUPERVISOR, preview.id);
    expect(down.statusCode, down.body).toBe(503);
    expect(down.json()).toMatchObject({ type: 'documents-unavailable' });
    expect((await releases())[0]).toMatchObject({ status: 'preview', manifestDocumentId: null });

    const release = await published(preview.id);
    expect(release.status).toBe('published');
    expect(manifests()).toHaveLength(1);
  });

  it('S6: 404 for a release that does not exist, 400 for an id that is not a UUID', async () => {
    expect((await publish(SUPERVISOR, randomUUID())).statusCode).toBe(404);
    expect((await withdraw(SUPERVISOR, randomUUID())).statusCode).toBe(404);
    expect((await publish(SUPERVISOR, 'not-a-uuid')).statusCode).toBe(400);
  });

  it('S7: an eacc-supervisor withdraws a published release with a reason; files still there, event; the next build is version 2', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();
    await published(preview.id);
    const files = api.files.objects.size;

    api.clock.set('2028-09-02T10:00:00.000Z');
    const response = await withdraw(SUPERVISOR, preview.id, { reason: `  ${REASON} ` });
    expect(response.statusCode, response.body).toBe(200);
    const withdrawn = response.json<OpenDataReleaseView>();
    expect(
      contractErrors(okResponse(`${RELEASES}/{releaseId}/withdraw`, 'post'), withdrawn),
    ).toEqual([]);
    expect(withdrawn).toMatchObject({
      id: preview.id,
      status: 'withdrawn',
      publishedAt: PUBLISHED_AT,
      withdrawnAt: '2028-09-02T10:00:00.000Z',
      withdrawnBy: { subject: SUPERVISOR.sub, name: 'Joseph Mwangi' },
      withdrawnReason: REASON,
      manifestVerificationId: expect.stringMatching(/^ADL-/) as string,
      tables: preview.tables,
    });
    // Kept in the history, its files still served.
    expect(api.files.objects.size).toBe(files);
    for (const table of preview.tables) {
      expect(
        sha256(
          api.files.objects.get(`releases/${preview.id}/${table.table}.json`)?.body ??
            Buffer.alloc(0),
        ),
      ).toBe(table.sha256Json);
    }
    // Its manifest revoked through documents: the verify page shows it revoked, withdrawn.
    expect(api.documents.revoked).toEqual([
      {
        documentId: withdrawn.manifestDocumentId,
        issuerTenant: 'eacc',
        reason: 'withdrawn',
        idempotencyKey: expect.any(String) as string,
      },
    ]);
    const [event] = await api.events(OPEN_DATA_RELEASE_WITHDRAWN);
    expect(event).toMatchObject({
      tenant: 'eacc',
      subject: preview.id,
      data: { releaseId: preview.id, fy: RELEASE_FY, kind: 'snapshot', version: 1 },
    });
    expect(JSON.stringify(event)).not.toContain('wrong financial year');

    // Withdrawn once; a corrected build is the next version, a preview again.
    const again = await withdraw(SUPERVISOR, preview.id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'release-not-published' });
    expect(api.documents.revoked).toHaveLength(1);
    const corrected = await snapshotBuilt();
    expect(corrected).toMatchObject({ kind: 'snapshot', version: 2, status: 'preview' });
    expect((await releases()).map(({ version, status }) => ({ version, status }))).toEqual([
      { version: 2, status: 'preview' },
      { version: 1, status: 'withdrawn' },
    ]);
    // A withdrawn release is not published again.
    const republish = await publish(SUPERVISOR, preview.id);
    expect(republish.statusCode).toBe(409);
  });

  it('S7: only an eacc-supervisor withdraws, only a published release, and with a reason', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();

    const notPublished = await withdraw(SUPERVISOR, preview.id);
    expect(notPublished.statusCode).toBe(409);
    expect(notPublished.json()).toMatchObject({ code: 'release-not-published' });

    await published(preview.id);
    for (const caller of [ANALYST, COMMISSION_ADMIN, SUPERVISOR_OF_PSC]) {
      expect((await withdraw(caller, preview.id)).statusCode, caller.sub).toBe(403);
    }
    for (const body of [
      {},
      { reason: '   ' },
      { reason: 'x'.repeat(1001) },
      { reason: 'x', by: 'me' },
    ]) {
      expect((await withdraw(SUPERVISOR, preview.id, body)).statusCode, JSON.stringify(body)).toBe(
        400,
      );
    }
    expect((await releases())[0]).toMatchObject({ status: 'published', withdrawnReason: null });
    expect(await api.events(OPEN_DATA_RELEASE_WITHDRAWN)).toEqual([]);
    expect(api.documents.revoked).toEqual([]);
  });

  it('S7: 503 while documents is down withdraws nothing and leaves the manifest valid; withdrawing again revokes it once', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();
    const release = await published(preview.id);

    api.documents.failCalls(1);
    const down = await withdraw(SUPERVISOR, release.id);
    expect(down.statusCode, down.body).toBe(503);
    expect(down.json()).toMatchObject({ type: 'documents-unavailable' });
    expect((await releases())[0]).toMatchObject({ status: 'published', withdrawnReason: null });
    expect(api.documents.revoked).toEqual([]);
    expect(await api.events(OPEN_DATA_RELEASE_WITHDRAWN)).toEqual([]);

    const response = await withdraw(SUPERVISOR, release.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'withdrawn', withdrawnReason: REASON });
    expect(api.documents.revocationOf(release.manifestDocumentId ?? '')).toMatchObject({
      reason: 'withdrawn',
    });
    expect(api.documents.revoked).toHaveLength(1);
    expect(await api.events(OPEN_DATA_RELEASE_WITHDRAWN)).toHaveLength(1);
  });

  it('S7: 502 when documents refuses to revoke the manifest; nothing is withdrawn', async () => {
    await givenReleaseYear(api);
    await ncrBuilt();
    const preview = await snapshotBuilt();
    await published(preview.id);
    // A manifest documents does not know as EACC's: it refuses the revocation.
    await api.asPlatform((tx) =>
      tx
        .update(openDataReleases)
        .set({ manifestDocumentId: randomUUID() })
        .where(eq(openDataReleases.id, preview.id)),
    );

    const response = await withdraw(SUPERVISOR, preview.id);
    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toMatchObject({ code: 'manifest-revocation-refused' });
    expect((await releases())[0]).toMatchObject({ status: 'published' });
    expect(await api.events(OPEN_DATA_RELEASE_WITHDRAWN)).toEqual([]);
  });

  it('S7: a withdrawn annual release is corrected by an annual build, version 2, a preview published deliberately', async () => {
    await givenReleaseYear(api);
    const annual = await annualPublished();

    // While the year's annual release is published, no corrected one is built.
    for (const caller of [ANALYST, SUPERVISOR]) {
      const refused = await build(caller, { fy: RELEASE_FY, kind: 'annual' });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'annual-release-published' });
    }

    api.clock.set('2028-09-02T10:00:00.000Z');
    const withdrawn = await withdraw(SUPERVISOR, annual.id);
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    expect(api.documents.revocationOf(annual.manifestDocumentId ?? '')).toMatchObject({
      reason: 'withdrawn',
    });

    // An analyst builds the corrected annual release: a preview, the next annual version.
    api.clock.set('2028-09-03T09:00:00.000Z');
    const response = await build(ANALYST, { fy: RELEASE_FY, kind: 'annual' });
    expect(response.statusCode, response.body).toBe(202);
    const corrected = response.json<OpenDataReleaseView>();
    expect(contractErrors(okResponse(RELEASES, 'post', 202), corrected)).toEqual([]);
    expect(corrected).toMatchObject({
      fy: RELEASE_FY,
      kind: 'annual',
      version: 2,
      status: 'preview',
      builtAt: '2028-09-03T09:00:00.000Z',
      publishedBy: null,
      manifestDocumentId: null,
    });
    expect(corrected.id).not.toBe(annual.id);
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(openDataReleases).where(eq(openDataReleases.id, corrected.id)),
    );
    expect(row?.builtBy).toBe(ANALYST.sub);
    // Not published by itself.
    expect(manifests()).toHaveLength(1);
    expect(await api.events(OPEN_DATA_RELEASE_PUBLISHED)).toHaveLength(1);
    expect(await api.events(OPEN_DATA_RELEASE_BUILT)).toEqual([
      expect.objectContaining({ data: { ...idsOf(annual) } }),
      expect.objectContaining({
        data: { releaseId: corrected.id, fy: RELEASE_FY, kind: 'annual', version: 2 },
      }),
    ]);

    // A supervisor publishes it: its own manifest, version 2, by them.
    const release = await published(corrected.id);
    expect(release).toMatchObject({
      kind: 'annual',
      version: 2,
      status: 'published',
      publishedBy: { subject: SUPERVISOR.sub, name: 'Joseph Mwangi' },
    });
    expect(release.manifestDocumentId).not.toBe(annual.manifestDocumentId);
    expect(manifests()[1]).toMatchObject({
      subjectRef: `open-data-release:${corrected.id}`,
      payload: { kind: 'annual', version: 2, publishedBy: 'Joseph Mwangi' },
    });
    expect(
      (await releases()).map(({ kind, version, status }) => ({ kind, version, status })),
    ).toEqual([
      { kind: 'annual', version: 2, status: 'published' },
      { kind: 'annual', version: 1, status: 'withdrawn' },
    ]);

    // Published again: no further corrected build until it is withdrawn.
    const again = await build(SUPERVISOR, { fy: RELEASE_FY, kind: 'annual' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'annual-release-published' });
  });

  it('S7: an annual preview is not published while another annual release of the year is', async () => {
    await givenReleaseYear(api);
    const annual = await annualPublished();
    expect((await withdraw(SUPERVISOR, annual.id)).statusCode).toBe(200);
    const second = (
      await build(ANALYST, { fy: RELEASE_FY, kind: 'annual' })
    ).json<OpenDataReleaseView>();
    const third = (
      await build(ANALYST, { fy: RELEASE_FY, kind: 'annual' })
    ).json<OpenDataReleaseView>();
    expect([second.version, third.version]).toEqual([2, 3]);
    await published(second.id);

    const response = await publish(SUPERVISOR, third.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'annual-release-published' });
    expect((await releases()).find((each) => each.id === third.id)).toMatchObject({
      status: 'preview',
      manifestDocumentId: null,
    });
    expect(manifests().map((each) => each.subjectRef)).toEqual([
      `open-data-release:${annual.id}`,
      `open-data-release:${second.id}`,
    ]);
  });

  it('S7: an annual release is built from the approved NCR only; a snapshot stays the default', async () => {
    await givenReleaseYear(api);

    const notBuilt = await build(ANALYST, { fy: RELEASE_FY, kind: 'annual' });
    expect(notBuilt.statusCode).toBe(409);
    expect(notBuilt.json()).toMatchObject({ code: 'ncr-not-built' });

    await ncrBuilt();
    const draft = await build(SUPERVISOR, { fy: RELEASE_FY, kind: 'annual' });
    expect(draft.statusCode).toBe(409);
    expect(draft.json()).toMatchObject({ code: 'ncr-not-approved' });
    expect(await releases()).toEqual([]);

    const snapshot = await build(ANALYST, { fy: RELEASE_FY, kind: 'snapshot' });
    expect(snapshot.statusCode).toBe(202);
    expect(snapshot.json()).toMatchObject({ kind: 'snapshot', version: 1 });

    for (const caller of [COMMISSION_ADMIN, SUPERVISOR_OF_PSC]) {
      expect((await build(caller, { fy: RELEASE_FY, kind: 'annual' })).statusCode).toBe(403);
    }
  });

  it('S5, S9: a report changed after the NCR was built does not hold the annual release back: built from the approved NCR, its totals are the NCR’s', async () => {
    await givenReleaseYear(api);
    const ncr = await ncrBuilt();
    // A report changes after the NCR was built (a correction the NCR has not taken in).
    await api.asPlatform(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(reportReceipts)
        .where(eq(reportReceipts.tenant, 'psc'));
      if (!receipt) throw new Error('no psc receipt');
      await tx
        .update(reportReceipts)
        .set({
          counts: {
            ...receipt.counts,
            initial: { ...receipt.counts.initial, declared: receipt.counts.initial.declared - 1 },
          },
        })
        .where(eq(reportReceipts.reportId, receipt.reportId));
    });

    const release = await annualPublished(ncr);

    const totals = storedTable(release.id, 'national-totals');
    const value = (measure: string) => totals.rows.find((row) => row.measure === measure)?.value;
    expect(value('expected')).toBe(ncr.aggregates.national.all.expected);
    expect(value('filed')).toBe(ncr.aggregates.national.all.declared);
    expect(value('nonFilers')).toBe(ncr.aggregates.national.all.notDeclared);
    expect(value('clarificationsIssued')).toBe(ncr.aggregates.national.clarifications);
    expect(value('commissionsReported')).toBe(ncr.aggregates.reporting.reported);
    expect(manifests()).toHaveLength(1);
  });
});

function idsOf(release: OpenDataReleaseView) {
  return { releaseId: release.id, fy: release.fy, kind: release.kind, version: release.version };
}
