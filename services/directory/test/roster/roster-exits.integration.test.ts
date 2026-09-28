import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import type { RosterSummary } from '../../src/commissions/representation.js';
import { outbox, rosterImportRows, rosterRecords, rosterSummaries } from '../../src/db/schema.js';
import type { ExitsResult, KeepResult } from '../../src/roster/exits/representation.js';
import type { RosterImport } from '../../src/roster/import/representation.js';
import type { RosterRecord, RosterRecordPage } from '../../src/roster/records/representation.js';
import { todayInNairobi } from '../../src/roster/row-validation.js';
import { refreshRosterSummary } from '../../src/roster/summary.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec #27 scenarios S8, S9, S11, S12 and S13 over HTTP: a declared-complete import flags the
 * officers it left out, the reporting officer confirms exits or keeps records, and a later row
 * re-activates an exited officer. Imports run on compose Temporal against a real Postgres.
 */
const ROSTER = '/v1/commissions/psc/roster';
const OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };

const HEADER = 'personnel_file_number,full_name,national_id,designation';
const ROW = {
  achieng: 'PSC/0001,Achieng Otieno,12345678,Officer',
  kiprono: 'PSC/0002,Kiprono Kipchumba,23456789,Officer',
  wanjiru: 'PSC/0003,Wanjiru Kamau,34567890,Officer',
  mary: 'PSC/0004,Mary Wambui,45678901,Officer',
};
const EVERYONE = Object.values(ROW);
const csv = (rows: string[]) => [HEADER, ...rows].join('\n') + '\n';

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'tsc', name: 'Teachers Service Commission' },
  ]);
});

/** Imports `rows` for psc through the import endpoints and waits for the import to complete. */
async function importRoster(rows: string[], declaredComplete: boolean): Promise<RosterImport> {
  const uploadId = api.uploads.add('psc', { bytes: csv(rows), fileName: 'psc.csv' });
  const started = await api.post(
    `${ROSTER}/imports`,
    { channel: 'file', uploadId, declaredComplete },
    OFFICER,
  );
  expect(started.statusCode, started.body).toBe(202);
  const { id } = started.json<RosterImport>();
  const deadline = Date.now() + 25_000;
  for (;;) {
    const response = await api.get(`${ROSTER}/imports/${id}`, OFFICER);
    const body = response.json<RosterImport>();
    if (body.state === 'completed') return body;
    if (body.state === 'failed' || Date.now() > deadline) {
      throw new Error(`import ${id} did not complete: ${response.body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function flagged(): Promise<RosterRecordPage['items']> {
  const response = await api.get(`${ROSTER}/records?flagged=true`, OFFICER);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<RosterRecordPage>().items;
}

async function summary(): Promise<RosterSummary> {
  const response = await api.get(`${ROSTER}/summary`, OFFICER);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<RosterSummary>();
}

async function record(id: string): Promise<RosterRecord> {
  const response = await api.get(`${ROSTER}/records/${id}`, OFFICER);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<RosterRecord>();
}

/** Record ids by personnel file number, read over HTTP. */
async function recordIds(): Promise<Map<string, string>> {
  const response = await api.get(`${ROSTER}/records?limit=200`, OFFICER);
  const items = response.json<RosterRecordPage>().items;
  return new Map(items.map((item) => [item.personnelFileNumber, item.id]));
}

function idOf(ids: Map<string, string>, fileNumber: string): string {
  const id = ids.get(fileNumber);
  if (!id) throw new Error(`no record ${fileNumber}`);
  return id;
}

/** Roster tables are under FORCE RLS; stamps not in the contract are read as the platform. */
const storedRecords = () =>
  withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(rosterRecords).orderBy(asc(rosterRecords.personnelFileNumber)),
  );

const events = async (type: string) =>
  (await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox))
    .filter((event) => event.type === type)
    .map((event) => event.envelope);

const confirmExits = (body: unknown, caller: Caller = OFFICER, idempotencyKey?: string) =>
  api.post(`${ROSTER}/exits`, body, caller, { idempotencyKey });

const keep = (body: unknown, caller: Caller = OFFICER, idempotencyKey?: string) =>
  api.post(`${ROSTER}/keep`, body, caller, { idempotencyKey });

/** Everyone imported, then a complete import without Wanjiru and Mary: two flagged. */
async function givenTwoFlagged(): Promise<{ ids: Map<string, string>; flaggedBy: RosterImport }> {
  await importRoster(EVERYONE, true);
  const flaggedBy = await importRoster([ROW.achieng, ROW.kiprono], true);
  return { ids: await recordIds(), flaggedBy };
}

function daysAgo(days: number): string {
  const date = new Date(`${todayInNairobi()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

describe('S8 complete import missing an officer', () => {
  it('flags that record as absent, leaves the others clear and counts it', async () => {
    await importRoster(EVERYONE, true);

    const second = await importRoster([ROW.achieng, ROW.kiprono, ROW.mary], true);

    expect(second.counts).toMatchObject({ flaggedAbsent: 1 });
    const [wanjiru, ...others] = await flagged();
    expect(others).toEqual([]);
    expect(wanjiru).toMatchObject({
      personnelFileNumber: 'PSC/0003',
      absentFromLatestImport: true,
      flaggedByImportId: second.id,
      state: 'not_onboarded',
    });
    expect(wanjiru?.flaggedAt).not.toBeNull();
    const clear = await api.get(`${ROSTER}/records?flagged=false`, OFFICER);
    expect(clear.json<RosterRecordPage>().items.map((item) => item.flaggedByImportId)).toEqual([
      null,
      null,
      null,
    ]);
    expect(await summary()).toMatchObject({ expectedDeclarants: 4, flagged: 1 });
    expect((await events('roster.import.completed.v1')).at(-1)?.data).toMatchObject({
      importId: second.id,
      counts: { flaggedAbsent: 1 },
    });
  });

  it('clears the flag of an officer back in the next complete import', async () => {
    await importRoster(EVERYONE, true);
    await importRoster([ROW.achieng], true);

    const third = await importRoster(EVERYONE, true);

    expect(third.counts).toMatchObject({ flaggedAbsent: 0 });
    expect(await flagged()).toEqual([]);
    expect(await summary()).toMatchObject({ flagged: 0 });
  });

  it('moves a flag still standing to the latest complete import', async () => {
    await importRoster(EVERYONE, true);
    await importRoster([ROW.achieng, ROW.kiprono, ROW.mary], true);

    const third = await importRoster([ROW.achieng, ROW.kiprono, ROW.mary], true);

    expect(third.counts).toMatchObject({ flaggedAbsent: 1 });
    expect((await flagged()).map((item) => item.flaggedByImportId)).toEqual([third.id]);
    expect(await summary()).toMatchObject({ flagged: 1 });
  });

  it('does not flag an officer whose row was rejected, since they are in the file', async () => {
    await importRoster(EVERYONE, true);

    const second = await importRoster(
      [ROW.achieng, ROW.kiprono, '  psc/0003 ,Wanjiru Kamau,not-an-id,Officer', ROW.mary],
      true,
    );

    expect(second.counts).toMatchObject({ rejected: 1, flaggedAbsent: 0 });
    expect(await flagged()).toEqual([]);
    const wanjiru = (await storedRecords()).find((row) => row.personnelFileNumber === 'PSC/0003');
    expect(wanjiru?.lastSeenImportId).toBe(second.id);
    const [rejected] = await withTenant(
      api.db,
      { tenant: PLATFORM_TENANT, subject: 'test' },
      (tx) =>
        tx
          .select()
          .from(rosterImportRows)
          .where(eq(rosterImportRows.importId, second.id))
          .orderBy(asc(rosterImportRows.rowNumber))
          .offset(2),
    );
    expect(rejected).toMatchObject({ status: 'rejected', recordId: null });
  });

  it('never flags an exited officer', async () => {
    const { ids } = await givenTwoFlagged();
    await confirmExits({ records: [{ recordId: idOf(ids, 'PSC/0003') }], exitDate: daysAgo(1) });

    const next = await importRoster([ROW.achieng, ROW.kiprono], true);

    expect(next.counts).toMatchObject({ flaggedAbsent: 1 });
    expect((await flagged()).map((item) => item.personnelFileNumber)).toEqual(['PSC/0004']);
  });
});

describe('S9 partial import', () => {
  it('changes no flags', async () => {
    const { flaggedBy } = await givenTwoFlagged();

    const partial = await importRoster([ROW.wanjiru], false);

    expect(partial.counts).toMatchObject({ flaggedAbsent: 0, unchanged: 1 });
    expect(
      (await flagged()).map((item) => [item.personnelFileNumber, item.flaggedByImportId]),
    ).toEqual([
      ['PSC/0004', flaggedBy.id],
      ['PSC/0003', flaggedBy.id],
    ]);
    expect(await summary()).toMatchObject({ flagged: 2 });
  });
});

describe('S11 confirm exits', () => {
  it('exits two records with one date, clears their flags, reduces expected and records the event', async () => {
    const { ids } = await givenTwoFlagged();
    const exitDate = daysAgo(3);
    const wanjiru = idOf(ids, 'PSC/0003');
    const mary = idOf(ids, 'PSC/0004');

    const response = await confirmExits({
      records: [{ recordId: wanjiru }, { recordId: mary }],
      exitDate,
    });

    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<ExitsResult>();
    expect(result).toEqual({ batchId: expect.any(String) as string, count: 2 });
    expect(
      contractErrors(okResponse(`/v1/commissions/{slug}/roster/exits`, 'post'), result),
    ).toEqual([]);
    for (const id of [wanjiru, mary]) {
      expect(await record(id)).toMatchObject({
        state: 'exited',
        exitDate,
        absentFromLatestImport: false,
        flaggedByImportId: null,
        flaggedAt: null,
        source: 'file',
      });
    }
    expect(await flagged()).toEqual([]);
    expect(await summary()).toMatchObject({ expectedDeclarants: 2, flagged: 0 });
    const stamped = (await storedRecords()).filter((row) => row.state === 'exited');
    expect(stamped.map((row) => row.flagClearedBy)).toEqual(['officer-psc', 'officer-psc']);
    expect(stamped.every((row) => row.flagClearedAt !== null)).toBe(true);
    expect(await events('roster.exits.confirmed.v1')).toEqual([
      expect.objectContaining({
        subject: result.batchId,
        tenant: 'psc',
        data: {
          batchId: result.batchId,
          count: 2,
          source: 'console',
          recordIds: [wanjiru, mary],
          actor: { kind: 'user', id: 'officer-psc' },
        },
      }),
    ]);
  });

  it('gives a record its own date over the batch date', async () => {
    const { ids } = await givenTwoFlagged();
    const wanjiru = idOf(ids, 'PSC/0003');
    const mary = idOf(ids, 'PSC/0004');

    const response = await confirmExits({
      records: [{ recordId: wanjiru, exitDate: daysAgo(30) }, { recordId: mary }],
      exitDate: daysAgo(1),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect((await record(wanjiru)).exitDate).toBe(daysAgo(30));
    expect((await record(mary)).exitDate).toBe(daysAgo(1));
  });

  it('takes per-record dates without a batch date, and exits records that are not flagged', async () => {
    const { ids } = await givenTwoFlagged();
    const achieng = idOf(ids, 'PSC/0001');

    const response = await confirmExits({
      records: [{ recordId: achieng, exitDate: todayInNairobi() }],
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(await record(achieng)).toMatchObject({ state: 'exited', exitDate: todayInNairobi() });
    expect(await summary()).toMatchObject({ expectedDeclarants: 3, flagged: 2 });
  });

  it('replays the result for the same Idempotency-Key, exiting once', async () => {
    const { ids } = await givenTwoFlagged();
    const body = { records: [{ recordId: idOf(ids, 'PSC/0003') }], exitDate: daysAgo(1) };
    const key = randomUUID();

    const first = await confirmExits(body, OFFICER, key);
    const replay = await confirmExits(body, OFFICER, key);

    expect(replay.statusCode).toBe(200);
    expect(replay.json<ExitsResult>()).toEqual(first.json<ExitsResult>());
    expect(await events('roster.exits.confirmed.v1')).toHaveLength(1);
    const reused = await confirmExits({ ...body, exitDate: daysAgo(2) }, OFFICER, key);
    expect(reused.statusCode).toBe(422);
  });

  it('refuses records already exited, changing nothing', async () => {
    const { ids } = await givenTwoFlagged();
    const wanjiru = idOf(ids, 'PSC/0003');
    const mary = idOf(ids, 'PSC/0004');
    await confirmExits({ records: [{ recordId: wanjiru }], exitDate: daysAgo(5) });

    const response = await confirmExits({
      records: [{ recordId: mary }, { recordId: wanjiru }],
      exitDate: daysAgo(1),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>()).toMatchObject({
      type: 'record-exited',
      errors: [{ path: 'records.1.recordId', message: 'Already exited' }],
    });
    expect(await record(mary)).toMatchObject({
      state: 'not_onboarded',
      absentFromLatestImport: true,
    });
    expect((await record(wanjiru)).exitDate).toBe(daysAgo(5));
  });

  it("refuses records not on the Commission's roster, changing nothing", async () => {
    const { ids } = await givenTwoFlagged();
    const unknown = randomUUID();

    const response = await confirmExits({
      records: [{ recordId: idOf(ids, 'PSC/0003') }, { recordId: unknown }],
      exitDate: daysAgo(1),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<Problem>()).toMatchObject({
      type: 'record-not-found',
      errors: [{ path: 'records.1.recordId' }],
    });
    expect(await summary()).toMatchObject({ expectedDeclarants: 4, flagged: 2 });
    expect(await events('roster.exits.confirmed.v1')).toEqual([]);
  });

  it('validates dates and duplicates', async () => {
    const { ids } = await givenTwoFlagged();
    const wanjiru = idOf(ids, 'PSC/0003');
    const tomorrow = daysAgo(-1);

    const future = await confirmExits({ records: [{ recordId: wanjiru }], exitDate: tomorrow });
    const missing = await confirmExits({ records: [{ recordId: wanjiru }] });
    const twice = await confirmExits({
      records: [{ recordId: wanjiru }, { recordId: wanjiru }],
      exitDate: daysAgo(1),
    });
    const empty = await confirmExits({ records: [], exitDate: daysAgo(1) });

    const paths = (response: typeof future) =>
      response.json<Problem>().errors?.map((error) => error.path);
    expect([future.statusCode, missing.statusCode, twice.statusCode, empty.statusCode]).toEqual([
      400, 400, 400, 400,
    ]);
    expect(paths(future)).toEqual(['exitDate']);
    expect(paths(missing)).toEqual(['exitDate']);
    expect(paths(twice)).toEqual(['records.1.recordId']);
    expect(paths(empty)).toEqual(['records']);
  });

  it("is the Commission's reporting officer's alone", async () => {
    const { ids } = await givenTwoFlagged();
    const body = { records: [{ recordId: idOf(ids, 'PSC/0003') }], exitDate: daysAgo(1) };

    const otherOfficer = await confirmExits(body, { ...OFFICER, tenant: 'tsc' });
    const viaOtherSlug = await api.post('/v1/commissions/tsc/roster/exits', body, {
      ...OFFICER,
      tenant: 'tsc',
    });
    const admin = await confirmExits(body, { tenant: 'psc', roles: ['commission-admin'] });
    const platformAdmin = await confirmExits(body, {
      tenant: 'platform',
      roles: ['platform-admin'],
    });
    const own = await confirmExits(body);

    expect(otherOfficer.statusCode).toBe(404);
    expect(viaOtherSlug.statusCode).toBe(404);
    expect(viaOtherSlug.json<Problem>().type).toBe('record-not-found');
    expect(admin.statusCode).toBe(403);
    expect(platformAdmin.statusCode).toBe(403);
    expect(own.statusCode).toBe(200);
    const withoutKey = await api.post(`${ROSTER}/exits`, body, OFFICER, { idempotencyKey: null });
    expect(withoutKey.statusCode).toBe(400);
  });
});

describe('S12 keep', () => {
  it('clears the flag and stamps who kept the record', async () => {
    const { ids } = await givenTwoFlagged();
    const wanjiru = idOf(ids, 'PSC/0003');

    const response = await keep({ recordIds: [wanjiru, idOf(ids, 'PSC/0001')] });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<KeepResult>()).toEqual({ count: 1 });
    expect(
      contractErrors(okResponse(`/v1/commissions/{slug}/roster/keep`, 'post'), response.json()),
    ).toEqual([]);
    expect(await record(wanjiru)).toMatchObject({
      state: 'not_onboarded',
      absentFromLatestImport: false,
      flaggedByImportId: null,
      flaggedAt: null,
    });
    const stored = (await storedRecords()).find((row) => row.id === wanjiru);
    expect(stored?.flagClearedBy).toBe('officer-psc');
    expect(stored?.flagClearedAt).not.toBeNull();
    expect(await summary()).toMatchObject({ expectedDeclarants: 4, flagged: 1 });
    expect(await events('roster.records.kept.v1')).toEqual([
      expect.objectContaining({
        subject: 'psc',
        tenant: 'psc',
        data: { count: 1, recordIds: [wanjiru], actor: { kind: 'user', id: 'officer-psc' } },
      }),
    ]);
  });

  it('flags a kept officer again when the next complete import still leaves them out', async () => {
    const { ids } = await givenTwoFlagged();
    const wanjiru = idOf(ids, 'PSC/0003');
    await keep({ recordIds: [wanjiru] });

    const next = await importRoster([ROW.achieng, ROW.kiprono, ROW.mary], true);

    expect(await record(wanjiru)).toMatchObject({
      absentFromLatestImport: true,
      flaggedByImportId: next.id,
    });
    const stored = (await storedRecords()).find((row) => row.id === wanjiru);
    expect(stored?.flagClearedBy).toBeNull();
  });

  it('replays for the same Idempotency-Key and counts nothing when kept again', async () => {
    const { ids } = await givenTwoFlagged();
    const body = { recordIds: [idOf(ids, 'PSC/0003')] };
    const key = randomUUID();

    const first = await keep(body, OFFICER, key);
    const replay = await keep(body, OFFICER, key);
    const again = await keep(body);

    expect(replay.json<KeepResult>()).toEqual(first.json<KeepResult>());
    expect(again.json<KeepResult>()).toEqual({ count: 0 });
    expect(await events('roster.records.kept.v1')).toHaveLength(1);
    const noKey = await api.post(`${ROSTER}/keep`, body, OFFICER, { idempotencyKey: null });
    expect(noKey.statusCode).toBe(400);
  });

  it('refuses unknown records and other callers', async () => {
    const { ids } = await givenTwoFlagged();
    const unknown = randomUUID();

    const notFound = await keep({ recordIds: [idOf(ids, 'PSC/0003'), unknown] });
    const invalid = await keep({ recordIds: ['nope'] });
    const otherOfficer = await keep({ recordIds: [unknown] }, { ...OFFICER, tenant: 'tsc' });
    const admin = await keep(
      { recordIds: [unknown] },
      { tenant: 'psc', roles: ['commission-admin'] },
    );

    expect(notFound.statusCode).toBe(404);
    expect(notFound.json<Problem>()).toMatchObject({
      type: 'record-not-found',
      errors: [{ path: 'recordIds.1' }],
    });
    expect(await summary()).toMatchObject({ flagged: 2 });
    expect(invalid.statusCode).toBe(400);
    expect(otherOfficer.statusCode).toBe(404);
    expect(admin.statusCode).toBe(403);
  });
});

describe('S13 import row for an exited officer', () => {
  it('re-activates the record, clears its exit date and counts the row updated', async () => {
    const { ids } = await givenTwoFlagged();
    const wanjiru = idOf(ids, 'PSC/0003');
    await confirmExits({ records: [{ recordId: wanjiru }], exitDate: daysAgo(10) });
    expect(await summary()).toMatchObject({ expectedDeclarants: 3 });

    const back = await importRoster([ROW.wanjiru], false);

    expect(back.counts).toMatchObject({ updated: 1, unchanged: 0 });
    const reactivated = await record(wanjiru);
    expect(reactivated).toMatchObject({
      state: 'not_onboarded',
      exitDate: null,
      absentFromLatestImport: false,
      lastSeenImportId: back.id,
    });
    expect(reactivated.imports[0]).toMatchObject({ importId: back.id, outcome: 'updated' });
    expect(await summary()).toMatchObject({ expectedDeclarants: 4, flagged: 1 });
  });
});

describe('roster summary after exits and keeps', () => {
  const recount = () =>
    withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      refreshRosterSummary(tx, 'psc'),
    );

  const storedSummary = () =>
    withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
      const [row] = await tx
        .select({
          expected: rosterSummaries.expected,
          onboarded: rosterSummaries.onboarded,
          flagged: rosterSummaries.flagged,
        })
        .from(rosterSummaries)
        .where(eq(rosterSummaries.tenant, 'psc'));
      return row;
    });

  it('moves the counts as a full recount of the records would', async () => {
    const { ids } = await givenTwoFlagged();
    const [achieng, kiprono, wanjiru, mary] = ['PSC/0001', 'PSC/0002', 'PSC/0003', 'PSC/0004'].map(
      (fileNumber) => idOf(ids, fileNumber),
    );
    // Onboarded officers, one of them flagged: an exit must stop counting them as onboarded.
    await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx
        .update(rosterRecords)
        .set({ state: 'onboarded' })
        .where(inArray(rosterRecords.id, [kiprono ?? '', wanjiru ?? ''])),
    );
    await recount();
    expect(await storedSummary()).toEqual({ expected: 4, onboarded: 2, flagged: 2 });

    const exited = await confirmExits({
      records: [{ recordId: wanjiru }, { recordId: achieng }],
      exitDate: daysAgo(1),
    });
    expect(exited.statusCode, exited.body).toBe(200);
    const kept = await keep({ recordIds: [mary, kiprono] });
    expect(kept.json<KeepResult>()).toEqual({ count: 1 });

    const adjusted = await storedSummary();
    await recount();
    expect(adjusted).toEqual(await storedSummary());
    expect(adjusted).toEqual({ expected: 2, onboarded: 1, flagged: 0 });
  });
});
