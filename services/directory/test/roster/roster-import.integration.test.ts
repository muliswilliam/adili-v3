import { PLATFORM_TENANT } from '@adili/api-kit';
import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client as TemporalClient } from '@temporalio/client';
import ExcelJS from 'exceljs';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  outbox,
  reportingEntities,
  rosterImportRows,
  rosterImports,
  rosterRecords,
  rosterSummaries,
} from '../../src/db/schema.js';
import type { RosterImport, RosterImportPreview } from '../../src/roster/import/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec #27 scenarios S4, S5, S7 and S10 over HTTP: file imports run by the directory's worker on
 * compose Temporal, against a real Postgres, with uploads served by the in-memory adapter.
 */
const IMPORTS = '/v1/commissions/psc/roster/imports';
const OFFICER: Caller = {
  sub: 'officer-psc',
  tenant: 'psc',
  roles: ['reporting-officer'],
  name: 'Fatuma Wanjiru',
};

const HEADER =
  'personnel_file_number,full_name,national_id,designation,job_group,reporting_entity,appointment_date,email,phone';
const ROWS = [
  'PSC/2019/0001,  Achieng   Mary Otieno ,2345 6789,Senior Officer,C3,Ministry of Health,07/01/2019,Mary.Otieno@Example.go.ke,0712 345 678',
  'PSC/2019/0002,Kiprono Kipchumba,12345678,,,ministry of  health,,,',
  'PSC/2020/0003,Wanjiru Kamau,34567890,Director,D1,State Department for ICT,2020-02-29,,+254 110 123456',
];
const csv = (rows: string[], header = HEADER) => [header, ...rows].join('\n') + '\n';

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'tsc', name: 'Teachers Service Commission' },
  ]);
});

/**
 * Waits for the imports a test left running (it failed, or timed out polling) to end: the next
 * test's reset truncates the tables under them, which deadlocks with a chunk being applied.
 */
afterEach(async () => {
  const running = await asPlatform((tx) =>
    tx
      .select({ id: rosterImports.id })
      .from(rosterImports)
      .where(inArray(rosterImports.state, ['pending', 'processing'])),
  );
  const temporal = api.app.get<TemporalClient>(TEMPORAL_CLIENT);
  // An import's workflow id is its id; one never started (or gone) has nothing to wait for.
  await Promise.all(
    running.map(({ id }) =>
      temporal.workflow
        .getHandle(id)
        .result()
        .catch(() => undefined),
    ),
  );
}, 120_000);

function start(body: unknown, caller: Caller = OFFICER, idempotencyKey?: string) {
  return api.post(IMPORTS, body, caller, { idempotencyKey });
}

/** Uploads `content` for psc and starts importing it; returns the 202 body. */
async function startImport(content: string, declaredComplete = true): Promise<RosterImport> {
  const uploadId = api.uploads.add('psc', { bytes: content, fileName: 'psc-roster.csv' });
  const response = await start({ channel: 'file', uploadId, declaredComplete });
  expect(response.statusCode, response.body).toBe(202);
  return response.json<RosterImport>();
}

/** Polls the import like the console does until it has ended, for up to `withinMs`. */
async function untilEnded(
  id: string,
  caller: Caller = OFFICER,
  imports = IMPORTS,
  withinMs = 25_000,
): Promise<RosterImport> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const response = await api.get(`${imports}/${id}`, caller);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<RosterImport>();
    if (body.state === 'completed' || body.state === 'failed') return body;
    if (Date.now() > deadline) throw new Error(`import ${id} still ${body.state}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function importFile(
  content: string,
  declaredComplete = true,
  withinMs?: number,
): Promise<RosterImport> {
  return untilEnded((await startImport(content, declaredComplete)).id, OFFICER, IMPORTS, withinMs);
}

/** Roster tables are under FORCE RLS; the test reads them in the platform context. */
function asPlatform<T>(work: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, work);
}

const records = () =>
  asPlatform((tx) =>
    tx.select().from(rosterRecords).orderBy(asc(rosterRecords.personnelFileNumber)),
  );

const importRows = (importId: string) =>
  asPlatform((tx) =>
    tx
      .select()
      .from(rosterImportRows)
      .where(eq(rosterImportRows.importId, importId))
      .orderBy(asc(rosterImportRows.rowNumber)),
  );

const summary = async () => {
  const [row] = await asPlatform((tx) =>
    tx.select().from(rosterSummaries).where(eq(rosterSummaries.tenant, 'psc')),
  );
  return row;
};

const events = () =>
  api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(outbox.id);

const IMPORT_PATH = '/v1/commissions/{slug}/roster/imports/{importId}';
const IMPORTS_POINTER = '~1v1~1commissions~1{slug}~1roster~1imports';

describe('S4 file import', () => {
  it('accepts the import, then creates the records, reporting entities, summary and event', async () => {
    const started = await startImport(csv(ROWS));

    expect(started).toMatchObject({
      channel: 'file',
      declaredComplete: true,
      state: 'pending',
      fileName: 'psc-roster.csv',
      format: 'csv',
      totalRows: null,
      processedRows: 0,
      counts: null,
      failure: null,
      startedBy: { kind: 'user', id: 'officer-psc', name: 'Fatuma Wanjiru' },
      completedAt: null,
    });
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/roster/imports', 'post', 202), started),
    ).toEqual([]);

    const done = await untilEnded(started.id);
    expect(done).toMatchObject({
      id: started.id,
      state: 'completed',
      totalRows: 3,
      processedRows: 3,
      counts: {
        accepted: 3,
        created: 3,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        flaggedAbsent: 0,
        exitsRecorded: 0,
      },
      // The file has spec 02's columns, not spec 05b's or the employer code.
      mapping: { ignored: [], missing: ['work_station', 'marital_status', 'employer_code'] },
      failure: null,
    });
    expect(done.mapping?.matched).toHaveLength(9);
    expect(done.completedAt).not.toBeNull();
    expect(contractErrors(okResponse(IMPORT_PATH, 'get'), done)).toEqual([]);

    const [first, second, third] = await records();
    expect(first).toMatchObject({
      tenant: 'psc',
      personnelFileNumber: 'PSC/2019/0001',
      fullName: 'Achieng Mary Otieno',
      nationalId: '23456789',
      designation: 'Senior Officer',
      jobGroup: 'C3',
      appointmentDate: '2019-01-07',
      email: 'mary.otieno@example.go.ke',
      phone: '+254712345678',
      state: 'not_onboarded',
      absentFromLatestImport: false,
      source: 'file',
      firstSeenImportId: started.id,
      lastSeenImportId: started.id,
    });
    expect(third).toMatchObject({ phone: '+254110123456', appointmentDate: '2020-02-29' });

    const entities = await asPlatform((tx) =>
      tx.select().from(reportingEntities).orderBy(asc(reportingEntities.normalisedName)),
    );
    expect(entities.map(({ name, normalisedName }) => ({ name, normalisedName }))).toEqual([
      { name: 'Ministry of Health', normalisedName: 'ministry of health' },
      { name: 'State Department for ICT', normalisedName: 'state department for ict' },
    ]);
    // Names differing only in case and spacing are one entity.
    expect(second?.reportingEntityId).toBe(first?.reportingEntityId);

    expect(await summary()).toMatchObject({
      expected: 3,
      onboarded: 0,
      flagged: 0,
      lastImportId: started.id,
    });
    expect((await summary())?.lastCompleteImportAt).not.toBeNull();

    expect(await events()).toEqual([
      {
        type: 'roster.import.completed.v1',
        envelope: expect.objectContaining({
          subject: started.id,
          tenant: 'psc',
          data: {
            importId: started.id,
            channel: 'file',
            declaredComplete: true,
            counts: done.counts,
            actor: { kind: 'user', id: 'officer-psc' },
          },
        }) as unknown,
      },
    ]);
  });

  // Three chunks through compose Temporal take seconds alone, and far longer on a loaded host.
  it(
    'applies files larger than a chunk in chunks of 1,000 rows',
    { timeout: 120_000 },
    async () => {
      const rows = Array.from(
        { length: 2_500 },
        (_, index) =>
          `PSC/${String(index).padStart(5, '0')},Officer Number ${index},${String(10_000_000 + index)},,,,,,`,
      );

      const done = await importFile(csv(rows), false, 110_000);

      expect(done).toMatchObject({
        state: 'completed',
        totalRows: 2_500,
        processedRows: 2_500,
        counts: { accepted: 2_500, created: 2_500, rejected: 0 },
      });
      const chunks = await asPlatform((tx) =>
        tx
          .selectDistinct({ chunk: rosterImportRows.chunkIndex })
          .from(rosterImportRows)
          .where(eq(rosterImportRows.importId, done.id)),
      );
      expect(chunks.map(({ chunk }) => chunk).sort()).toEqual([0, 1, 2]);
      expect(await summary()).toMatchObject({ expected: 2_500 });
      // A partial import still records the latest import, but not a latest complete one.
      expect((await summary())?.lastCompleteImportAt).toBeNull();
    },
  );

  it('rejects invalid rows into the report and applies the rest', async () => {
    const done = await importFile(
      csv([ROWS[0] ?? '', 'PSC/BAD,X,123,,,,,,', 'PSC/2019/0001,Duplicate Row,99999999,,,,,,']),
    );

    expect(done.counts).toMatchObject({ accepted: 1, created: 1, rejected: 2 });
    expect(done.processedRows).toBe(3);
    const rows = await importRows(done.id);
    expect(rows.map((row) => [row.rowNumber, row.status, row.outcome])).toEqual([
      [2, 'accepted', 'created'],
      [3, 'rejected', null],
      [4, 'rejected', null],
    ]);
    expect(rows[2]?.errors).toEqual([
      expect.objectContaining({ field: 'personnelFileNumber', code: 'duplicate-in-file' }),
    ]);
  });
});

describe('S5 missing required column', () => {
  it('fails the import naming the columns, with no rows staged', async () => {
    const done = await importFile(
      csv(['PSC/1,Jane Doe,Officer'], 'personnel_file_number,full_name,designation'),
    );

    expect(done).toMatchObject({
      state: 'failed',
      totalRows: null,
      processedRows: 0,
      failure: {
        code: 'missing-columns',
        detail: expect.stringContaining('national_id') as string,
      },
      mapping: {
        matched: [
          { source: 'personnel_file_number', field: 'personnel_file_number' },
          { source: 'full_name', field: 'full_name' },
          { source: 'designation', field: 'designation' },
        ],
      },
    });
    expect(contractErrors(okResponse(IMPORT_PATH, 'get'), done)).toEqual([]);
    expect(await importRows(done.id)).toEqual([]);
    expect(await records()).toEqual([]);
    expect((await events()).map((event) => event.envelope)).toEqual([
      expect.objectContaining({
        type: 'roster.import.failed.v1',
        tenant: 'psc',
        data: {
          importId: done.id,
          failureCode: 'missing-columns',
          actor: { kind: 'user', id: 'officer-psc' },
        },
      }),
    ]);
  });

  it('fails an unreadable file with parse-error', async () => {
    const done = await importFile('');

    expect(done).toMatchObject({ state: 'failed', failure: { code: 'parse-error' } });
  });
});

describe('S7 same file again', () => {
  it('classifies every row unchanged and creates no records', async () => {
    const first = await importFile(csv(ROWS));
    const before = await records();
    const summaryBefore = await summary();

    const again = await importFile(csv(ROWS));

    expect(again.id).not.toBe(first.id);
    expect(again.counts).toMatchObject({ accepted: 3, created: 0, updated: 0, unchanged: 3 });
    const after = await records();
    expect(after).toHaveLength(3);
    // Unchanged records are only marked seen.
    const unseen = (rows: typeof before) => rows.map((row) => ({ ...row, lastSeenImportId: null }));
    expect(unseen(after)).toEqual(unseen(before));
    expect(after.every((record) => record.lastSeenImportId === again.id)).toBe(true);
    expect(await summary()).toMatchObject({
      expected: summaryBefore?.expected,
      onboarded: summaryBefore?.onboarded,
      flagged: summaryBefore?.flagged,
      lastImportId: again.id,
    });
    const history = await asPlatform((tx) => tx.select().from(rosterImports));
    expect(history).toHaveLength(2);
  });
});

describe('S10 identity lock', () => {
  it("rejects a row changing an onboarded officer's national ID and applies other changes", async () => {
    await importFile(csv(ROWS));
    await asPlatform((tx) =>
      tx.update(rosterRecords).set({ state: 'onboarded' }).where(eq(rosterRecords.tenant, 'psc')),
    );
    const before = await records();

    const done = await importFile(
      csv([
        (ROWS[0] ?? '').replace('2345 6789', '99887766'),
        (ROWS[1] ?? '').replace('Kipchumba,12345678,', 'Kipchumba,12345678,Chief Officer'),
        ROWS[2] ?? '',
      ]),
    );

    expect(done.counts).toMatchObject({
      accepted: 2,
      created: 0,
      updated: 1,
      unchanged: 1,
      rejected: 1,
    });
    const rows = await importRows(done.id);
    expect(rows[0]).toMatchObject({
      status: 'rejected',
      outcome: null,
      recordId: before[0]?.id,
      errors: [
        { field: 'nationalId', code: 'identity-locked', message: expect.any(String) as string },
      ],
    });
    expect(rows[1]).toMatchObject({ status: 'accepted', outcome: 'updated' });

    const [locked, updated] = await records();
    expect(locked).toMatchObject({ nationalId: '23456789', state: 'onboarded' });
    // The officer was in the file, so the record counts as seen.
    expect(locked?.lastSeenImportId).toBe(done.id);
    expect(updated).toMatchObject({ designation: 'Chief Officer', state: 'onboarded' });
  });

  it('keeps contacts the declarant supplied at onboarding, and applies roster-sourced ones', async () => {
    await importFile(csv(ROWS));
    // Kiprono had no contacts on the roster and supplied both at onboarding (spec 03).
    await asPlatform((tx) =>
      tx
        .update(rosterRecords)
        .set({
          state: 'onboarded',
          email: 'kiprono@example.com',
          emailSource: 'declarant',
          phone: '+254700111222',
          phoneSource: 'declarant',
        })
        .where(eq(rosterRecords.personnelFileNumber, 'PSC/2019/0002')),
    );

    const unchanged = await importFile(csv(ROWS));
    const done = await importFile(
      csv([
        (ROWS[0] ?? '').replace('0712 345 678', '0722 000 111'),
        (ROWS[1] ?? '').replace(/,,$/, ',kiprono@psc.go.ke,0733 000 222'),
        ROWS[2] ?? '',
      ]),
    );

    expect(unchanged.counts).toMatchObject({ updated: 0, unchanged: 3 });
    expect(done.counts).toMatchObject({ updated: 1, unchanged: 2, rejected: 0 });
    const [mary, kiprono] = await records();
    expect(mary).toMatchObject({ phone: '+254722000111', phoneSource: 'roster' });
    expect(kiprono).toMatchObject({
      email: 'kiprono@example.com',
      emailSource: 'declarant',
      phone: '+254700111222',
      phoneSource: 'declarant',
    });
  });

  it('lets a record that is not onboarded change its national ID', async () => {
    await importFile(csv(ROWS));

    const done = await importFile(csv([(ROWS[0] ?? '').replace('2345 6789', '99887766')]), false);

    expect(done.counts).toMatchObject({ updated: 1, rejected: 0 });
    expect((await records())[0]?.nationalId).toBe('99887766');
  });
});

describe('national ID on another roster', () => {
  const TSC_OFFICER: Caller = { sub: 'officer-tsc', tenant: 'tsc', roles: ['reporting-officer'] };

  /** tsc's roster: Kiprono (still there) and Wanjiru (exited, a transfer already resolved). */
  async function givenTscRoster(): Promise<void> {
    const tsc = '/v1/commissions/tsc/roster';
    const uploadId = api.uploads.add('tsc', {
      bytes: csv(
        ['TSC/1,Kiprono Kipchumba,12345678', 'TSC/2,Wanjiru Kamau,34567890'],
        'personnel_file_number,full_name,national_id',
      ),
    });
    const started = await api.post(
      `${tsc}/imports`,
      { channel: 'file', uploadId, declaredComplete: true },
      TSC_OFFICER,
    );
    expect(started.statusCode, started.body).toBe(202);
    const done = await untilEnded(started.json<RosterImport>().id, TSC_OFFICER, `${tsc}/imports`);
    expect(done.counts).toMatchObject({ created: 2, noted: 0 });
    const page = (await api.get(`${tsc}/records?search=TSC/2`, TSC_OFFICER)).json<{
      items: { id: string }[];
    }>();
    const exit = await api.post(
      `${tsc}/exits`,
      { records: [{ recordId: page.items[0]?.id }], exitDate: '2026-01-15' },
      TSC_OFFICER,
    );
    expect(exit.statusCode, exit.body).toBe(200);
  }

  it('applies the row and notes it, without naming the other Commission', async () => {
    await givenTscRoster();

    const done = await importFile(csv(ROWS));

    expect(done.counts).toMatchObject({ accepted: 3, created: 3, rejected: 0, noted: 1 });
    const response = await api.get(`${IMPORTS}/${done.id}/rows`, OFFICER);
    expect(response.statusCode, response.body).toBe(200);
    expect(contractErrors(okResponse(`${IMPORT_PATH}/rows`, 'get'), response.json())).toEqual([]);
    const rows = response.json<{ items: { rowNumber: number; notes: unknown[] }[] }>().items;
    expect(rows.map((row) => [row.rowNumber, row.notes])).toEqual([
      [2, []],
      [
        3,
        [
          {
            field: 'nationalId',
            code: 'national-id-on-another-roster',
            message: expect.any(String) as string,
          },
        ],
      ],
      // Wanjiru has exited tsc's roster: nothing to note.
      [4, []],
    ]);
    expect(response.body).not.toMatch(/tsc|Teachers/i);
    // Allowed: both rosters keep the officer.
    expect((await records()).filter((record) => record.nationalId === '12345678')).toHaveLength(2);
  });

  it("looks at other rosters without leaving the importing tenant's context", async () => {
    await givenTscRoster();

    const seen = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, async (tx) => {
      const { rows: found } = await tx.execute(
        sql`select roster_national_ids_on_other_rosters(array['12345678', '34567890', '1', '12345678']) as found`,
      );
      const { rows: context } = await tx.execute<{ tenant: string }>(
        sql`select current_setting('app.tenant') as tenant`,
      );
      const visible = await tx.select().from(rosterRecords);
      return { found, context: context[0]?.tenant, visible };
    });

    // One boolean per ID asked about, in order, and nothing else of the other roster.
    expect(seen).toEqual({
      found: [{ found: [true, false, false, true] }],
      context: 'psc',
      visible: [],
    });
  });

  it('answers only in a Commission context, and only for other Commissions', async () => {
    await givenTscRoster();
    const lookup = (tenant: string) =>
      withTenant(api.db, { tenant, subject: 'test' }, async (tx) => {
        const { rows } = await tx.execute<{ found: boolean[] }>(
          sql`select roster_national_ids_on_other_rosters(array['12345678']) as found`,
        );
        return rows[0]?.found;
      });

    // tsc's own officer is not "on another roster" for tsc.
    expect(await lookup('tsc')).toEqual([false]);
    await expect(lookup('platform')).rejects.toThrow();
  });

  it('runs as its owner with a pinned search path, and PUBLIC may not call it', async () => {
    const { rows } = await api.db.execute(sql`
      select p.prosecdef as definer,
        p.proconfig = array['search_path=pg_catalog, ' || current_schema() || ', pg_temp']
          as "searchPathPinned",
        has_function_privilege('public', p.oid, 'execute') as "publicCanExecute"
      from pg_proc as p
      where p.proname = 'roster_national_ids_on_other_rosters'
        and p.pronamespace = current_schema()::regnamespace
    `);

    expect(rows).toEqual([{ definer: true, searchPathPinned: true, publicCanExecute: false }]);
  });
});

describe('starting an import', () => {
  it('refuses a second import while one is in progress, naming the running one', async () => {
    const [running] = await asPlatform((tx) =>
      tx
        .insert(rosterImports)
        .values({
          tenant: 'psc',
          channel: 'file',
          declaredComplete: false,
          format: 'csv',
          state: 'processing',
          startedByKind: 'user',
          startedBy: 'someone-else',
        })
        .returning(),
    );
    const uploadId = api.uploads.add('psc', { bytes: csv(ROWS) });

    const response = await start({ channel: 'file', uploadId, declaredComplete: true });

    expect(response.statusCode).toBe(409);
    const problem = response.json<Problem & { importId?: string }>();
    expect(problem).toMatchObject({ type: 'import-in-progress', importId: running?.id });
    expect(
      contractErrors(
        `/paths/${IMPORTS_POINTER}/post/responses/409/content/application~1problem+json/schema`,
        problem,
      ),
    ).toEqual([]);
  });

  it('replays the same import for the same Idempotency-Key', async () => {
    const uploadId = api.uploads.add('psc', { bytes: csv(ROWS) });
    const key = randomUUID();
    const body = { channel: 'file', uploadId, declaredComplete: true };

    const first = await start(body, OFFICER, key);
    const replay = await start(body, OFFICER, key);

    expect(replay.statusCode).toBe(202);
    expect(replay.json<RosterImport>().id).toBe(first.json<RosterImport>().id);
    await untilEnded(first.json<RosterImport>().id);
  });

  it('answers 404 for an upload of another Commission and 409 for one not clean', async () => {
    const otherTenants = api.uploads.add('tsc', { bytes: csv(ROWS) });
    const infected = api.uploads.addNotClean('psc');

    const notFound = await start({
      channel: 'file',
      uploadId: otherTenants,
      declaredComplete: true,
    });
    const notClean = await start({ channel: 'file', uploadId: infected, declaredComplete: true });

    expect(notFound.statusCode).toBe(404);
    expect(notFound.json<Problem>().type).toBe('upload-not-found');
    expect(notClean.statusCode).toBe(409);
    expect(notClean.json<Problem>().type).toBe('upload-not-clean');
    expect(await asPlatform((tx) => tx.select().from(rosterImports))).toEqual([]);
  });

  it('answers 502 when documents is unavailable, recording nothing', async () => {
    const uploadId = api.uploads.add('psc', { bytes: csv(ROWS) });
    api.uploads.failNext();

    const response = await start({ channel: 'file', uploadId, declaredComplete: true });

    expect(response.statusCode).toBe(502);
    expect(response.json<Problem>().type).toBe('documents-unavailable');
  });

  it("is the Commission's reporting officer's alone", async () => {
    const uploadId = api.uploads.add('psc', { bytes: csv(ROWS) });
    const body = { channel: 'file', uploadId, declaredComplete: true };

    const otherOfficer = await start(body, { ...OFFICER, tenant: 'tsc' });
    const admin = await start(body, { tenant: 'psc', roles: ['commission-admin'] });

    expect(otherOfficer.statusCode).toBe(404);
    expect(admin.statusCode).toBe(403);
  });

  it('validates the body', async () => {
    const response = await start({ channel: 'file', uploadId: 'nope' });

    expect(response.statusCode).toBe(400);
    expect(
      response
        .json<Problem>()
        .errors?.map((error) => error.path)
        .sort(),
    ).toEqual(['declaredComplete', 'uploadId']);
  });
});

describe('reading an import', () => {
  it("shows it to the Commission's staff and national readers, and 404 to others", async () => {
    const done = await importFile(csv(ROWS));
    const path = `${IMPORTS}/${done.id}`;

    for (const caller of [
      { tenant: 'psc', roles: ['commission-admin'] },
      { tenant: 'eacc', roles: ['eacc-analyst'] },
      { tenant: 'eacc', roles: ['eacc-supervisor'] },
      { tenant: 'platform', roles: ['platform-admin'] },
    ]) {
      const response = await api.get(path, caller);
      expect(response.statusCode, JSON.stringify(caller)).toBe(200);
      expect(response.json<RosterImport>().id).toBe(done.id);
    }
    expect((await api.get(path, { ...OFFICER, tenant: 'tsc' })).statusCode).toBe(404);
    expect(
      (
        await api.get(`/v1/commissions/tsc/roster/imports/${done.id}`, {
          tenant: 'eacc',
          roles: ['eacc-analyst'],
        })
      ).statusCode,
    ).toBe(404);
    expect((await api.get(`${IMPORTS}/${randomUUID()}`, OFFICER)).statusCode).toBe(404);
    expect((await api.get(path, { tenant: 'psc', roles: ['reviewer'] })).statusCode).toBe(403);
  });
});

describe('previewing an import', () => {
  const preview = (uploadId: string, caller: Caller = OFFICER) =>
    api.post(`${IMPORTS}/preview`, { uploadId }, caller, { idempotencyKey: null });

  it('shows the column mapping and counts the rows of a CSV file', async () => {
    const uploadId = api.uploads.add('psc', {
      bytes: csv(ROWS, `${HEADER},Station Code`),
      fileName: 'psc-roster.csv',
    });

    const response = await preview(uploadId);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<RosterImportPreview>();
    expect(body).toMatchObject({
      uploadId,
      fileName: 'psc-roster.csv',
      format: 'csv',
      missingRequired: [],
      estimatedRows: 3,
      mapping: {
        ignored: ['Station Code'],
        missing: ['work_station', 'marital_status', 'employer_code'],
      },
    });
    expect(body.mapping.matched[0]).toEqual({
      source: 'personnel_file_number',
      field: 'personnel_file_number',
    });
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/roster/imports/preview', 'post'), body),
    ).toEqual([]);
    // Nothing is imported.
    expect(await asPlatform((tx) => tx.select().from(rosterImports))).toEqual([]);
  });

  it('names the missing required columns', async () => {
    const uploadId = api.uploads.add('psc', {
      bytes: csv(['PSC/1,Jane Doe'], 'personnelFileNumber,Full Name'),
    });

    const body = (await preview(uploadId)).json<RosterImportPreview>();

    expect(body).toMatchObject({
      missingRequired: ['national_id'],
      estimatedRows: null,
      mapping: {
        matched: [
          { source: 'personnelFileNumber', field: 'personnel_file_number' },
          { source: 'Full Name', field: 'full_name' },
        ],
      },
    });
    expect(body.mapping.missing).toContain('designation');
  });

  it('counts the rows of an XLSX file', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Roster');
    sheet.addRow(['personnel_file_number', 'full_name', 'national_id']);
    sheet.addRow(['PSC/1', 'Jane Doe', '12345678']);
    sheet.addRow(['PSC/2', 'John Doe', '23456789']);
    const uploadId = api.uploads.add('psc', {
      bytes: new Uint8Array(await book.xlsx.writeBuffer()),
      format: 'xlsx',
    });

    const body = (await preview(uploadId)).json<RosterImportPreview>();

    expect(body).toMatchObject({ format: 'xlsx', missingRequired: [], estimatedRows: 2 });
  });

  it('estimates the rows of a large CSV file from its lines', async () => {
    const rows = Array.from(
      { length: 12_345 },
      (_, index) => `PSC/${index},Officer Number ${index},${String(10_000_000 + index)}`,
    );
    const uploadId = api.uploads.add('psc', {
      bytes: csv(rows, 'personnel_file_number,full_name,national_id'),
    });

    const body = (await preview(uploadId)).json<RosterImportPreview>();

    expect(body.estimatedRows).toBe(12_345);
  });

  it('answers 422 for an unreadable file, 409 for an upload not clean and 404 for others', async () => {
    const empty = await preview(api.uploads.add('psc', { bytes: '' }));
    const notClean = await preview(api.uploads.addNotClean('psc'));
    const otherTenants = await preview(api.uploads.add('tsc', { bytes: csv(ROWS) }));

    expect(empty.statusCode).toBe(422);
    expect(empty.json<Problem>().type).toBe('unreadable-file');
    expect(notClean.statusCode).toBe(409);
    expect(otherTenants.statusCode).toBe(404);
    expect(otherTenants.json<Problem>().type).toBe('upload-not-found');
  });

  it("is the Commission's reporting officer's alone", async () => {
    const uploadId = api.uploads.add('psc', { bytes: csv(ROWS) });

    expect((await preview(uploadId, { ...OFFICER, tenant: 'tsc' })).statusCode).toBe(404);
    expect(
      (await preview(uploadId, { tenant: 'psc', roles: ['commission-admin'] })).statusCode,
    ).toBe(403);
  });
});
