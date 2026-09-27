import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { RosterSummary } from '../../src/commissions/representation.js';
import { config } from '../../src/config.js';
import { outbox, rosterApiCredentials } from '../../src/db/schema.js';
import type {
  RosterImport,
  RosterImportPage,
  RosterImportRowPage,
} from '../../src/roster/import/representation.js';
import type { RosterRecord, RosterRecordPage } from '../../src/roster/records/representation.js';
import { todayInNairobi } from '../../src/roster/row-validation.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenApiCredential, givenCommissions } from '../support/fixtures.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec #27 scenarios S15-S17 at the HTTP seam: a Commission's HR system pushes roster batches
 * through the same import workflow as files (on compose Temporal), reads their reports, and
 * records exits by personnel file number; its tokens are held to their tenant, scope and
 * credential, and rate limited.
 */
const ROSTER = '/v1/commissions/psc/roster';
const IMPORTS = `${ROSTER}/imports`;
const IMPORTS_PATH = '/v1/commissions/{slug}/roster/imports';
const EXIT_PATH = '/v1/commissions/{slug}/roster/records/{fileNumber}/exit';

const PSC_CLIENT = 'roster-psc-0a1b2c3d';
const TSC_CLIENT = 'roster-tsc-0a1b2c3d';
const PSC_HR: Caller = {
  sub: 'service-account-psc',
  tenant: 'psc',
  scope: 'roster:write',
  azp: PSC_CLIENT,
};
const TSC_HR: Caller = {
  sub: 'service-account-tsc',
  tenant: 'tsc',
  scope: 'roster:write',
  azp: TSC_CLIENT,
};
const OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };

interface RowInput {
  personnelFileNumber: string;
  fullName: string;
  nationalId: string;
  designation?: string | null;
  jobGroup?: string | null;
  reportingEntity?: string | null;
  appointmentDate?: string | null;
  email?: string | null;
  phone?: string | null;
}

const ACHIENG: RowInput = {
  personnelFileNumber: 'PSC/2019/0001',
  fullName: 'Achieng Mary Otieno',
  nationalId: '23456789',
  designation: 'Senior Officer',
  jobGroup: 'C3',
  reportingEntity: 'Ministry of Health',
  appointmentDate: '2019-01-07',
  email: 'mary.otieno@example.go.ke',
  phone: '0712345678',
};
const KIPRONO: RowInput = {
  personnelFileNumber: 'PSC/2019/0002',
  fullName: 'Kiprono Kipchumba',
  nationalId: '12345678',
};

/** `count` valid rows with distinct file numbers and national IDs. */
const manyRows = (count: number): RowInput[] =>
  Array.from({ length: count }, (_, index) => ({
    personnelFileNumber: `PSC/9/${String(index).padStart(5, '0')}`,
    fullName: `Officer Number ${index}`,
    nationalId: String(10_000_000 + index),
  }));

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
  await givenApiCredential(api.db, { tenant: 'psc', clientId: PSC_CLIENT });
  await givenApiCredential(api.db, { tenant: 'tsc', clientId: TSC_CLIENT });
});

const pushBatch = (
  rows: unknown,
  caller: Caller = PSC_HR,
  idempotencyKey: string | null = randomUUID(),
  path = IMPORTS,
) => api.post(path, { channel: 'api', rows }, caller, { idempotencyKey });

/** Polls the import as `caller` until it has ended. */
async function untilEnded(id: string, caller: Caller = PSC_HR): Promise<RosterImport> {
  const deadline = Date.now() + 25_000;
  for (;;) {
    const response = await api.get(`${IMPORTS}/${id}`, caller);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<RosterImport>();
    if (body.state === 'completed' || body.state === 'failed') return body;
    if (Date.now() > deadline) throw new Error(`import ${id} still ${body.state}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Pushes `rows` as psc's HR system and waits for the import to end. */
async function imported(rows: RowInput[]): Promise<RosterImport> {
  const response = await pushBatch(rows);
  expect(response.statusCode, response.body).toBe(202);
  return untilEnded(response.json<RosterImport>().id);
}

const exitPath = (fileNumber: string, slug = 'psc') =>
  `/v1/commissions/${slug}/roster/records/${encodeURIComponent(fileNumber)}/exit`;

const recordExit = (
  fileNumber: string,
  exitDate = '2026-08-31',
  caller: Caller = PSC_HR,
  slug = 'psc',
) => api.post(exitPath(fileNumber, slug), { exitDate }, caller);

const events = async (type: string) =>
  (await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox))
    .filter((event) => event.type === type)
    .map((event) => event.envelope);

const credential = async (tenant: string) => {
  const [row] = await withTenant(api.db, { tenant, subject: 'test' }, (tx) =>
    tx.select().from(rosterApiCredentials).where(eq(rosterApiCredentials.tenant, tenant)),
  );
  return row;
};

function expectProblem(
  response: Awaited<ReturnType<typeof api.get>>,
  status: number,
  type?: string,
): Problem {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = response.json<Problem>();
  if (type !== undefined) expect(problem.type).toBe(type);
  return problem;
}

describe('S15 batch import', () => {
  it('accepts a batch with 202 and an import id, then reports the created records', async () => {
    const response = await pushBatch([ACHIENG, KIPRONO]);

    expect(response.statusCode, response.body).toBe(202);
    const started = response.json<RosterImport>();
    expect(contractErrors(okResponse(IMPORTS_PATH, 'post', 202), started)).toEqual([]);
    expect(started).toMatchObject({
      channel: 'api',
      declaredComplete: false,
      state: 'pending',
      fileName: null,
      format: 'json',
      mapping: null,
      counts: null,
      startedBy: { kind: 'client', id: PSC_CLIENT, name: PSC_CLIENT },
    });

    const ended = await untilEnded(started.id);
    expect(ended).toMatchObject({
      state: 'completed',
      totalRows: 2,
      processedRows: 2,
      mapping: null,
      counts: {
        accepted: 2,
        created: 2,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        flaggedAbsent: 0,
        exitsRecorded: 0,
      },
    });
    const records = (await api.get(`${ROSTER}/records`, OFFICER)).json<RosterRecordPage>();
    expect(records.items.map((record) => record.personnelFileNumber)).toEqual([
      'PSC/2019/0001',
      'PSC/2019/0002',
    ]);
    const detail = await api.get(`${ROSTER}/records/${records.items[0]?.id}`, OFFICER);
    expect(detail.json<RosterRecord>()).toMatchObject({
      source: 'api',
      firstSeenImportId: started.id,
    });
    expect(await events('roster.import.completed.v1')).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({ importId: started.id, channel: 'api' }) as unknown,
      }),
    ]);
  });

  it('replays the same response for the same key and body, and refuses another body (422)', async () => {
    const key = randomUUID();
    const first = await pushBatch([ACHIENG, KIPRONO], PSC_HR, key);
    expect(first.statusCode, first.body).toBe(202);
    await untilEnded(first.json<RosterImport>().id);

    const replay = await pushBatch([ACHIENG, KIPRONO], PSC_HR, key);
    expect(replay.statusCode).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());

    const other = await pushBatch([ACHIENG], PSC_HR, key);
    expectProblem(other, 422, 'idempotency-key-reused');

    const history = await api.get(IMPORTS, OFFICER);
    expect(history.json<RosterImportPage>().items).toHaveLength(1);
  });

  it('rejects rows that break row rules in the report, like a file, and applies the others', async () => {
    const ended = await imported([
      ACHIENG,
      { ...KIPRONO, nationalId: '12AB' },
      { ...KIPRONO, personnelFileNumber: 'PSC/2019/0001', nationalId: '99887766' },
      { personnelFileNumber: 'PSC/2020/0003', fullName: 'Wanjiru Kamau', nationalId: '34567890' },
    ]);

    expect(ended.counts).toMatchObject({ accepted: 2, created: 2, rejected: 2 });
    const rows = await api.get(`${IMPORTS}/${ended.id}/rows?status=rejected`, PSC_HR);
    expect(rows.statusCode, rows.body).toBe(200);
    const page = rows.json<RosterImportRowPage>();
    expect(contractErrors(okResponse(`${IMPORTS_PATH}/{importId}/rows`, 'get'), page)).toEqual([]);
    expect(
      page.items.map((row) => [
        row.rowNumber,
        row.errors.map((error) => [error.field, error.code]),
      ]),
    ).toEqual([
      [2, [['nationalId', 'format']]],
      [3, [['personnelFileNumber', 'duplicate-in-file']]],
    ]);
    // Only the fields sent, as sent.
    expect(page.items[0]?.raw).toEqual({
      personnelFileNumber: 'PSC/2019/0002',
      fullName: 'Kiprono Kipchumba',
      nationalId: '12AB',
    });
  });

  it('lets the HR system read its imports, rows and rejected rows report', async () => {
    const ended = await imported([ACHIENG, { ...KIPRONO, nationalId: 'x' }]);

    const history = await api.get(IMPORTS, PSC_HR);
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json<RosterImportPage>().items.map((item) => item.id)).toEqual([ended.id]);
    expect((await api.get(`${IMPORTS}/${ended.id}/rows`, PSC_HR)).statusCode).toBe(200);
    const report = await api.get(`${IMPORTS}/${ended.id}/report.csv`, PSC_HR);
    expect(report.statusCode, report.body).toBe(200);
    expect(report.body).toContain('PSC/2019/0002');
    expect((await api.get(`${ROSTER}/summary`, PSC_HR)).statusCode).toBe(200);
  });

  it("shows the batch in the console's import history with channel api", async () => {
    const ended = await imported([ACHIENG]);

    const history = await api.get(IMPORTS, OFFICER);

    expect(history.json<RosterImportPage>().items).toEqual([
      expect.objectContaining({ id: ended.id, channel: 'api', state: 'completed' }),
    ]);
  });

  it('refuses a batch while another import of the Commission runs (409)', async () => {
    const first = await pushBatch(manyRows(1000));
    expect(first.statusCode, first.body).toBe(202);

    const second = await pushBatch([ACHIENG]);

    expect(second.statusCode, second.body).toBe(409);
    expect(second.json()).toMatchObject({
      type: 'import-in-progress',
      importId: first.json<RosterImport>().id,
    });
    await untilEnded(first.json<RosterImport>().id);
  });
});

describe('S16 tenant, scope and batch shape', () => {
  it("404s a token for psc writing to tsc's roster", async () => {
    expectProblem(
      await pushBatch([ACHIENG], PSC_HR, randomUUID(), '/v1/commissions/tsc/roster/imports'),
      404,
    );
    expectProblem(await recordExit('TSC/0001', '2026-08-31', PSC_HR, 'tsc'), 404);
    const ended = await imported([ACHIENG]);
    expectProblem(await api.get(`${IMPORTS}/${ended.id}`, TSC_HR), 404);
  });

  it('403s a token without roster:write', async () => {
    const noScope: Caller = { ...PSC_HR, scope: 'profile email' };

    expectProblem(await pushBatch([ACHIENG], noScope), 403);
    expectProblem(await recordExit('PSC/2019/0001', '2026-08-31', noScope), 403);
    expectProblem(await api.get(`${ROSTER}/summary`, noScope), 403);
  });

  it('400s 1,001 rows, and no rows', async () => {
    const tooMany = expectProblem(await pushBatch(manyRows(1001)), 400);
    expect(contractErrors(componentSchema('RosterBatchProblem'), tooMany)).toEqual([]);
    expect(tooMany.errors).toEqual([expect.objectContaining({ path: 'rows' })]);

    expect(expectProblem(await pushBatch([]), 400).errors).toEqual([
      expect.objectContaining({ path: 'rows' }),
    ]);
  });

  it('400s a structurally wrong row, pointing at its index and field', async () => {
    const problem = expectProblem(
      await pushBatch([ACHIENG, KIPRONO, ACHIENG, { ...KIPRONO, nationalId: 12345678 }, 'row']),
      400,
    );

    expect(contractErrors(componentSchema('RosterBatchProblem'), problem)).toEqual([]);
    expect(problem.errors).toEqual([
      { path: 'rows.3.nationalId', rowIndex: 3, message: expect.any(String) as unknown },
      { path: 'rows.4', rowIndex: 4, message: expect.any(String) as unknown },
    ]);
  });

  it('400s a batch without rows or with an unknown channel', async () => {
    expectProblem(await api.post(IMPORTS, { channel: 'api' }, PSC_HR), 400);
    expectProblem(await api.post(IMPORTS, { channel: 'fax', rows: [ACHIENG] }, PSC_HR), 400);
  });
});

describe('S17 explicit exit', () => {
  it('exits a record by personnel file number, with the event', async () => {
    await imported([ACHIENG, KIPRONO]);

    const response = await recordExit('PSC/2019/0001');

    expect(response.statusCode, response.body).toBe(200);
    const record = response.json<RosterRecord>();
    expect(contractErrors(okResponse(EXIT_PATH, 'post'), record)).toEqual([]);
    expect(record).toMatchObject({
      personnelFileNumber: 'PSC/2019/0001',
      state: 'exited',
      exitDate: '2026-08-31',
      source: 'api',
      flaggedByImportId: null,
    });
    const [event] = await events('roster.exits.confirmed.v1');
    expect(event).toMatchObject({
      tenant: 'psc',
      data: {
        count: 1,
        source: 'api',
        recordIds: [record.id],
        actor: { kind: 'client', id: PSC_CLIENT },
      },
    });
    const summary = await api.get(`${ROSTER}/summary`, PSC_HR);
    expect(summary.json<RosterSummary>()).toMatchObject({ expectedDeclarants: 1 });
  });

  it('matches the file number case-insensitively, trimmed', async () => {
    await imported([ACHIENG]);

    const response = await recordExit(' psc/2019/0001 ');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<RosterRecord>().personnelFileNumber).toBe('PSC/2019/0001');
  });

  it('decodes %2F in the file number and leaves /records/{recordId} to the record', async () => {
    await imported([ACHIENG, { ...KIPRONO, personnelFileNumber: 'PSC-0002' }]);
    const encoded = `${ROSTER}/records/PSC%2F2019%2F0001/exit`;

    const exited = await api.post(encoded, { exitDate: '2026-08-31' }, PSC_HR);
    expect(exited.statusCode, exited.body).toBe(200);
    expect((await recordExit('PSC-0002')).statusCode).toBe(200);

    const byId = await api.get(`${ROSTER}/records/${exited.json<RosterRecord>().id}`, OFFICER);
    expect(byId.statusCode, byId.body).toBe(200);
    expect(byId.json<RosterRecord>().state).toBe('exited');
  });

  it('404s an unknown file number', async () => {
    await imported([ACHIENG]);

    expectProblem(await recordExit('PSC/2019/9999'), 404, 'record-not-found');
  });

  it('409s a record that has exited already', async () => {
    await imported([ACHIENG]);
    expect((await recordExit('PSC/2019/0001')).statusCode).toBe(200);

    expectProblem(await recordExit('PSC/2019/0001', '2026-09-01'), 409, 'record-exited');
    expect(await events('roster.exits.confirmed.v1')).toHaveLength(1);
  });

  it('400s an exit date in the future', async () => {
    await imported([ACHIENG]);
    const tomorrow = new Date(`${todayInNairobi()}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const problem = expectProblem(
      await recordExit('PSC/2019/0001', tomorrow.toISOString().slice(0, 10)),
      400,
    );
    expect(problem.errors).toEqual([expect.objectContaining({ path: 'exitDate' })]);
  });

  it('counts the exit on the complete import that flagged the officer', async () => {
    await imported([ACHIENG, KIPRONO]);
    const uploadId = api.uploads.add('psc', {
      bytes: `personnel_file_number,full_name,national_id\n${ACHIENG.personnelFileNumber},${ACHIENG.fullName},${ACHIENG.nationalId}\n`,
      fileName: 'psc.csv',
    });
    const started = await api.post(
      IMPORTS,
      { channel: 'file', uploadId, declaredComplete: true },
      OFFICER,
    );
    expect(started.statusCode, started.body).toBe(202);
    const complete = await untilEnded(started.json<RosterImport>().id, OFFICER);
    expect(complete.counts).toMatchObject({ flaggedAbsent: 1, exitsRecorded: 0 });

    expect((await recordExit(KIPRONO.personnelFileNumber)).statusCode).toBe(200);

    const after = await api.get(`${IMPORTS}/${complete.id}`, OFFICER);
    expect(after.json<RosterImport>().counts).toMatchObject({ flaggedAbsent: 1, exitsRecorded: 1 });
  });
});

describe('credential enforcement', () => {
  it('401s tokens of a revoked credential at once', async () => {
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.update(rosterApiCredentials).set({ revokedAt: new Date() }),
    );

    expectProblem(await pushBatch([ACHIENG]), 401);
    expectProblem(await api.get(`${ROSTER}/summary`, PSC_HR), 401);
    expectProblem(await recordExit('PSC/2019/0001'), 401);
  });

  it('401s tokens issued before the secret was rotated, and accepts newer ones', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 120;
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.update(rosterApiCredentials).set({ rotatedAt: new Date((issuedAt + 60) * 1000) }),
    );

    expectProblem(await api.get(`${ROSTER}/summary`, { ...PSC_HR, iat: issuedAt }), 401);
    expect((await api.get(`${ROSTER}/summary`, PSC_HR)).statusCode).toBe(200);
  });

  it('401s roster:write tokens of a client that is not a credential of the tenant', async () => {
    expectProblem(
      await api.get(`${ROSTER}/summary`, { ...PSC_HR, azp: 'roster-psc-ffffffff' }),
      401,
    );
    expectProblem(await api.get(`${ROSTER}/summary`, { ...PSC_HR, azp: TSC_CLIENT }), 401);
  });

  it('bumps lastUsedAt at most once a minute', async () => {
    // A client id of its own: the throttle outlives the tables reset between tests.
    const clientId = `roster-psc-${randomUUID().slice(0, 8)}`;
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.update(rosterApiCredentials).set({ keycloakClientId: clientId }),
    );
    const hr: Caller = { ...PSC_HR, azp: clientId };
    expect((await credential('psc'))?.lastUsedAt).toBeNull();

    expect((await api.get(`${ROSTER}/summary`, hr)).statusCode).toBe(200);
    const first = (await credential('psc'))?.lastUsedAt;
    expect(first).toBeInstanceOf(Date);
    const pushed = await pushBatch([ACHIENG], hr);
    expect(pushed.statusCode).toBe(202);
    await untilEnded(pushed.json<RosterImport>().id, hr);

    expect((await credential('psc'))?.lastUsedAt).toEqual(first);
    const shown = await api.get(`${ROSTER}/api-credential`, OFFICER);
    expect(shown.json<{ lastUsedAt: string }>().lastUsedAt).toBe(first?.toISOString());
    expect((await credential('tsc'))?.lastUsedAt).toBeNull();
  });

  it('leaves reporting officers alone', async () => {
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.update(rosterApiCredentials).set({ revokedAt: new Date() }),
    );

    expect((await api.get(`${ROSTER}/summary`, OFFICER)).statusCode).toBe(200);
  });
});

describe('rate limits', () => {
  it('sends the RateLimit headers on every response of the HR routes', async () => {
    const write = config.RATE_LIMITS['roster-write'];
    const read = config.RATE_LIMITS['roster-read'];
    const responses = {
      accepted: await pushBatch([ACHIENG], { ...PSC_HR, sub: 'hr-headers' }),
      notFound: await recordExit('PSC/2019/9999', '2026-08-31', { ...PSC_HR, sub: 'hr-headers' }),
      forbidden: await pushBatch([ACHIENG], { ...PSC_HR, sub: 'hr-headers', scope: 'profile' }),
      read: await api.get(`${ROSTER}/summary`, { ...PSC_HR, sub: 'hr-headers' }),
    };

    await untilEnded(responses.accepted.json<RosterImport>().id);

    for (const [name, response] of Object.entries(responses)) {
      expect(response.headers['ratelimit-limit'], name).toBe(
        String(name === 'read' ? read?.limit : write?.limit),
      );
      expect(response.headers['ratelimit-remaining'], name).toEqual(expect.any(String));
      expect(response.headers['ratelimit-reset'], name).toEqual(expect.any(String));
    }
  });

  it('429s past the limit, with Retry-After, without running the request', async () => {
    const limit = config.RATE_LIMITS['roster-write']?.limit ?? 0;
    const burst: Caller = { ...PSC_HR, sub: 'hr-burst' };
    // Writes to another Commission's roster: 404 while the handler runs, 429 once it does not.
    // The bucket refills while the burst runs, so it passes at least `limit` requests.
    const tsc = '/v1/commissions/tsc/roster/imports';
    let passed = 0;
    let refused: Awaited<ReturnType<typeof pushBatch>> | undefined;
    while (refused === undefined && passed < 2 * limit) {
      const response = await pushBatch([ACHIENG], burst, randomUUID(), tsc);
      if (response.statusCode === 429) refused = response;
      else {
        expect(response.statusCode).toBe(404);
        passed += 1;
      }
    }

    expect(passed).toBeGreaterThanOrEqual(limit);
    expect(refused).toBeDefined();
    if (!refused) return;
    expectProblem(refused, 429, 'rate-limit-exceeded');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['ratelimit-remaining']).toBe('0');
  });
});
