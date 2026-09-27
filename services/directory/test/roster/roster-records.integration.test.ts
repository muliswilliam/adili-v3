import { withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import type { Commission, RosterSummary } from '../../src/commissions/representation.js';
import { rosterRecords } from '../../src/db/schema.js';
import type { RosterImport } from '../../src/roster/import/representation.js';
import type { RosterRecord, RosterRecordPage } from '../../src/roster/records/representation.js';
import { refreshRosterSummary } from '../../src/roster/summary.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec #27 scenarios S20-S22 over HTTP: who reads roster records and summaries, searching and
 * filtering records with masked national IDs, and the Commission read model's roster summary.
 * Rosters are imported through the import endpoints on compose Temporal; states slice 03 and
 * the exit flow (#50) will set are arranged in the database.
 */
const PSC_OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };
const TSC_OFFICER: Caller = { sub: 'officer-tsc', tenant: 'tsc', roles: ['reporting-officer'] };
const PSC_ADMIN: Caller = { tenant: 'psc', roles: ['commission-admin'] };
const PSC_REVIEWER: Caller = { tenant: 'psc', roles: ['reviewer'] };
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };
const EACC_ANALYST: Caller = { tenant: 'eacc', roles: ['eacc-analyst'] };
const EACC_SUPERVISOR: Caller = { tenant: 'eacc', roles: ['eacc-supervisor'] };
const PSC_HR_SYSTEM: Caller = { tenant: 'psc', scope: 'roster:write', azp: 'roster-psc-1a2b3c4d' };
const TSC_HR_SYSTEM: Caller = { tenant: 'tsc', scope: 'roster:write', azp: 'roster-tsc-1a2b3c4d' };

const HEADER =
  'personnel_file_number,full_name,national_id,designation,job_group,reporting_entity,appointment_date,email,phone';
const PSC_ROWS = [
  'PSC/2019/0001,Achieng Mary Otieno,23456789,Senior Officer,C3,Ministry of Health,2019-01-07,mary.otieno@example.go.ke,0712345678',
  'PSC/2019/0002,Kiprono Kipchumba,12345678,,,,,,',
  'PSC/2020/0003,Wanjiru Kamau,34567890,Director,D1,State Department for ICT,,,',
  'PSC/2020/0104,Mary Wambui,98765,,,,,,',
];
const TSC_ROWS = [
  'TSC/0001,Otieno James,56789012,Teacher,C1,Kisumu Boys High School,,,',
  'TSC/0002,Njeri Ann,67890123,Teacher,C1,Alliance Girls High School,,,',
];
const csv = (rows: string[]) => [HEADER, ...rows].join('\n') + '\n';

const records = (slug: string) => `/v1/commissions/${slug}/roster/records`;
const summaryOf = (slug: string) => `/v1/commissions/${slug}/roster/summary`;
const LIST_PATH = '/v1/commissions/{slug}/roster/records';
const RECORD_PATH = '/v1/commissions/{slug}/roster/records/{recordId}';
const SUMMARY_PATH = '/v1/commissions/{slug}/roster/summary';

let api: DirectoryApi;
let pscImport: RosterImport;
let tscImport: RosterImport;
/** Record ids by personnel file number. */
const ids = new Map<string, string>();

/** Imports `rows` for the tenant through the import endpoints and waits for the import to end. */
async function importRoster(
  slug: string,
  officer: Caller,
  rows: string[],
  declaredComplete: boolean,
): Promise<RosterImport> {
  const uploadId = api.uploads.add(slug, { bytes: csv(rows), fileName: `${slug}.csv` });
  const imports = `/v1/commissions/${slug}/roster/imports`;
  const started = await api.post(imports, { channel: 'file', uploadId, declaredComplete }, officer);
  expect(started.statusCode, started.body).toBe(202);
  const { id } = started.json<RosterImport>();
  const deadline = Date.now() + 25_000;
  for (;;) {
    const response = await api.get(`${imports}/${id}`, officer);
    const body = response.json<RosterImport>();
    if (body.state === 'completed') return body;
    if (body.state === 'failed' || Date.now() > deadline) {
      throw new Error(`import ${id} did not complete: ${response.body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Sets record fields as slice 03 or the exit flow would, keeping the summary current. */
async function givenRecord(
  tenant: string,
  fileNumber: string,
  values: Partial<typeof rosterRecords.$inferInsert>,
): Promise<void> {
  await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    await tx
      .update(rosterRecords)
      .set(values)
      .where(
        and(eq(rosterRecords.tenant, tenant), eq(rosterRecords.personnelFileNumber, fileNumber)),
      );
    await refreshRosterSummary(tx, tenant);
  });
}

async function list(caller: Caller, slug = 'psc', query = ''): Promise<RosterRecordPage> {
  const response = await api.get(`${records(slug)}${query}`, caller);
  expect(response.statusCode, response.body).toBe(200);
  const page = response.json<RosterRecordPage>();
  expect(contractErrors(okResponse(LIST_PATH, 'get'), page)).toEqual([]);
  return page;
}

const fileNumbers = (page: RosterRecordPage) => page.items.map((item) => item.personnelFileNumber);

function recordId(fileNumber: string): string {
  const id = ids.get(fileNumber);
  if (!id) throw new Error(`no record ${fileNumber}`);
  return id;
}

beforeAll(async () => {
  api = await startDirectoryApi();
  await api.reset();
  await givenCommissions(api.db, [
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'kdf', name: 'Defence Council', type: 'federated' },
  ]);
  pscImport = await importRoster('psc', PSC_OFFICER, PSC_ROWS, true);
  tscImport = await importRoster('tsc', TSC_OFFICER, TSC_ROWS, false);

  await givenRecord('psc', 'PSC/2019/0001', {
    absentFromLatestImport: true,
    flaggedByImportId: pscImport.id,
    flaggedAt: new Date('2026-09-25T08:00:00Z'),
  });
  await givenRecord('psc', 'PSC/2019/0002', { state: 'exited', exitDate: '2026-08-31' });
  await givenRecord('psc', 'PSC/2020/0003', { state: 'onboarded' });

  const all = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx
      .select({ id: rosterRecords.id, fileNumber: rosterRecords.personnelFileNumber })
      .from(rosterRecords),
  );
  for (const { id, fileNumber } of all) ids.set(fileNumber, id);
});

afterAll(async () => {
  await api.close();
});

describe('S20 visibility', () => {
  it.each([
    ['its reporting officer', PSC_OFFICER],
    ['its commission admin', PSC_ADMIN],
  ])("lists the Commission's records for %s", async (_who, caller) => {
    const page = await list(caller);

    expect(page.items).toHaveLength(4);
    expect(page.items.every((item) => item.personnelFileNumber.startsWith('PSC/'))).toBe(true);
  });

  it("answers 404 for another Commission's records, list and detail alike", async () => {
    const tscRecord = recordId('TSC/0001');

    for (const url of [
      records('tsc'),
      `${records('tsc')}/${tscRecord}`,
      `${records('psc')}/${tscRecord}`,
    ]) {
      const response = await api.get(url, PSC_OFFICER);
      expect(response.statusCode, url).toBe(404);
      expect(response.json<Problem>().status).toBe(404);
    }
  });

  it.each([
    ['eacc-analyst', EACC_ANALYST],
    ['eacc-supervisor', EACC_SUPERVISOR],
  ])('refuses records to %s (403) but serves the summary and imports', async (_role, caller) => {
    for (const url of [records('psc'), `${records('psc')}/${recordId('PSC/2019/0001')}`]) {
      const response = await api.get(url, caller);
      expect(response.statusCode, url).toBe(403);
      expect(response.json<Problem>()).toMatchObject({ status: 403, title: 'Forbidden' });
    }

    expect((await api.get(summaryOf('psc'), caller)).statusCode).toBe(200);
    expect(
      (await api.get(`/v1/commissions/psc/roster/imports/${pscImport.id}`, caller)).statusCode,
    ).toBe(200);
  });

  it("lets a platform admin read any Commission's records", async () => {
    expect(fileNumbers(await list(PLATFORM_ADMIN, 'tsc'))).toEqual(['TSC/0002', 'TSC/0001']);

    const response = await api.get(`${records('tsc')}/${recordId('TSC/0001')}`, PLATFORM_ADMIN);
    expect(response.statusCode).toBe(200);
    expect(response.json<RosterRecord>().nationalId).toBe('56789012');
  });

  it('answers 404 to a platform admin for a record of another Commission or none', async () => {
    const wrongCommission = await api.get(
      `${records('psc')}/${recordId('TSC/0001')}`,
      PLATFORM_ADMIN,
    );
    expect(wrongCommission.statusCode).toBe(404);

    for (const url of [records('nope'), summaryOf('nope')]) {
      expect((await api.get(url, PLATFORM_ADMIN)).statusCode, url).toBe(404);
    }
  });

  it('refuses records to HR systems and staff without a roster role', async () => {
    for (const caller of [PSC_HR_SYSTEM, PSC_REVIEWER]) {
      expect((await api.get(records('psc'), caller)).statusCode).toBe(403);
    }
  });

  it("serves the summary to the Commission's HR system, and 404 to another's", async () => {
    expect((await api.get(summaryOf('psc'), PSC_HR_SYSTEM)).statusCode).toBe(200);
    expect((await api.get(summaryOf('psc'), TSC_HR_SYSTEM)).statusCode).toBe(404);
    expect((await api.get(summaryOf('tsc'), PSC_OFFICER)).statusCode).toBe(404);
    expect((await api.get(summaryOf('psc'), PSC_REVIEWER)).statusCode).toBe(403);
  });
});

describe('S21 search and filters', () => {
  it('orders records by full name and masks national IDs in the list', async () => {
    const page = await list(PSC_OFFICER);

    expect(
      page.items.map(({ fullName, nationalIdMasked }) => [fullName, nationalIdMasked]),
    ).toEqual([
      ['Achieng Mary Otieno', '•••••789'],
      ['Kiprono Kipchumba', '•••••678'],
      ['Mary Wambui', '••765'],
      ['Wanjiru Kamau', '•••••890'],
    ]);
    expect(page.nextCursor).toBeNull();
    for (const item of page.items) expect(item).not.toHaveProperty('nationalId');
    expect(page.items[0]).toEqual({
      id: recordId('PSC/2019/0001'),
      personnelFileNumber: 'PSC/2019/0001',
      fullName: 'Achieng Mary Otieno',
      nationalIdMasked: '•••••789',
      designation: 'Senior Officer',
      jobGroup: 'C3',
      reportingEntity: { id: expect.any(String) as unknown, name: 'Ministry of Health' },
      state: 'not_onboarded',
      absentFromLatestImport: true,
      flaggedByImportId: pscImport.id,
      flaggedAt: '2026-09-25T08:00:00.000Z',
    });
  });

  it.each([
    ['a file number prefix, case-insensitively', 'psc/2020/', ['PSC/2020/0104', 'PSC/2020/0003']],
    ['a file number in full', 'PSC/2019/0002', ['PSC/2019/0002']],
    ['a name fragment, case-insensitively', 'MARY', ['PSC/2019/0001', 'PSC/2020/0104']],
    ['a full national ID', '12345678', ['PSC/2019/0002']],
    ['a full national ID written with spaces', '2345 6789', ['PSC/2019/0001']],
  ])('finds records by %s', async (_how, search, expected) => {
    const page = await list(PSC_OFFICER, 'psc', `?search=${encodeURIComponent(search)}`);

    expect(fileNumbers(page)).toEqual(expected);
  });

  it.each([
    ['the middle of a file number', '2020/0003'],
    ['part of a national ID', '1234567'],
    ['LIKE wildcards taken literally', '%'],
  ])('does not match %s', async (_what, search) => {
    const page = await list(PSC_OFFICER, 'psc', `?search=${encodeURIComponent(search)}`);

    expect(page.items).toEqual([]);
  });

  it.each([
    ['onboarded', '?state=onboarded', ['PSC/2020/0003']],
    ['exited', '?state=exited', ['PSC/2019/0002']],
    ['not onboarded', '?state=not_onboarded', ['PSC/2019/0001', 'PSC/2020/0104']],
    ['flagged', '?flagged=true', ['PSC/2019/0001']],
    ['not flagged', '?flagged=false', ['PSC/2019/0002', 'PSC/2020/0104', 'PSC/2020/0003']],
    [
      'search and state together',
      '?search=mary&state=not_onboarded',
      ['PSC/2019/0001', 'PSC/2020/0104'],
    ],
    ['search and flag together', '?search=mary&flagged=false', ['PSC/2020/0104']],
  ])('filters %s', async (_what, query, expected) => {
    expect(fileNumbers(await list(PSC_OFFICER, 'psc', query))).toEqual(expected);
  });

  it('pages with a cursor', async () => {
    const first = await list(PSC_OFFICER, 'psc', '?limit=3');
    expect(fileNumbers(first)).toEqual(['PSC/2019/0001', 'PSC/2019/0002', 'PSC/2020/0104']);
    expect(first.nextCursor).not.toBeNull();

    const second = await list(PSC_OFFICER, 'psc', `?limit=3&cursor=${first.nextCursor ?? ''}`);
    expect(fileNumbers(second)).toEqual(['PSC/2020/0003']);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ['an unknown cursor', '?cursor=nonsense', 'cursor'],
    ['a flag that is not true or false', '?flagged=yes', 'flagged'],
    ['an unknown state', '?state=retired', 'state'],
    ['a limit over 200', '?limit=201', 'limit'],
  ])('rejects %s with 400', async (_what, query, path) => {
    const response = await api.get(`${records('psc')}${query}`, PSC_OFFICER);

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.map((error) => error.path)).toContain(path);
  });

  it('shows one record in full, with its national ID and import history', async () => {
    const id = recordId('PSC/2019/0001');
    const response = await api.get(`${records('psc')}/${id}`, PSC_OFFICER);

    expect(response.statusCode).toBe(200);
    const body = response.json<RosterRecord>();
    expect(contractErrors(okResponse(RECORD_PATH, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      id,
      personnelFileNumber: 'PSC/2019/0001',
      fullName: 'Achieng Mary Otieno',
      nationalIdMasked: '•••••789',
      nationalId: '23456789',
      designation: 'Senior Officer',
      jobGroup: 'C3',
      reportingEntity: { id: expect.any(String) as unknown, name: 'Ministry of Health' },
      appointmentDate: '2019-01-07',
      email: 'mary.otieno@example.go.ke',
      phone: '+254712345678',
      state: 'not_onboarded',
      exitDate: null,
      absentFromLatestImport: true,
      flaggedByImportId: pscImport.id,
      flaggedAt: '2026-09-25T08:00:00.000Z',
      source: 'file',
      firstSeenImportId: pscImport.id,
      lastSeenImportId: pscImport.id,
      imports: [{ importId: pscImport.id, startedAt: pscImport.startedAt, outcome: 'created' }],
      createdAt: expect.any(String) as unknown,
      updatedAt: expect.any(String) as unknown,
    });
  });

  it('shows the exit date of an exited record', async () => {
    const response = await api.get(`${records('psc')}/${recordId('PSC/2019/0002')}`, PSC_ADMIN);

    expect(response.json<RosterRecord>()).toMatchObject({
      state: 'exited',
      exitDate: '2026-08-31',
      reportingEntity: null,
      designation: null,
      appointmentDate: null,
    });
  });

  it('answers 400 for a record id that is not a UUID', async () => {
    expect((await api.get(`${records('psc')}/PSC%2F2019%2F0001`, PSC_OFFICER)).statusCode).toBe(
      400,
    );
  });
});

describe('S22 roster summary', () => {
  const pscSummary = (): RosterSummary => ({
    status: 'imported',
    expectedDeclarants: 3,
    onboardedDeclarants: 1,
    flagged: 1,
    lastImportAt: pscImport.completedAt,
    lastImportId: pscImport.id,
    lastCompleteImportAt: pscImport.completedAt,
  });
  const NONE: RosterSummary = {
    status: 'none',
    expectedDeclarants: 0,
    onboardedDeclarants: 0,
    flagged: 0,
    lastImportAt: null,
    lastImportId: null,
    lastCompleteImportAt: null,
  };

  it('shows the imported summary on the Commission list, and none where nothing was imported', async () => {
    const response = await api.get('/v1/commissions', EACC_ANALYST);

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Commission[] }>();
    expect(contractErrors(okResponse('/v1/commissions', 'get'), body)).toEqual([]);
    const rosters = Object.fromEntries(body.items.map((item) => [item.slug, item.roster]));
    expect(rosters).toEqual({
      kdf: NONE,
      psc: pscSummary(),
      tsc: {
        status: 'imported',
        expectedDeclarants: 2,
        onboardedDeclarants: 0,
        flagged: 0,
        lastImportAt: tscImport.completedAt,
        lastImportId: tscImport.id,
        // A partial import is not a complete one.
        lastCompleteImportAt: null,
      },
    });
  });

  it('shows it on the Commission detail', async () => {
    const response = await api.get('/v1/commissions/psc', PSC_OFFICER);

    expect(response.statusCode).toBe(200);
    expect(response.json<Commission>().roster).toEqual(pscSummary());
  });

  it('serves the same summary on its own endpoint', async () => {
    for (const caller of [PSC_OFFICER, PSC_ADMIN, PLATFORM_ADMIN, EACC_SUPERVISOR, PSC_HR_SYSTEM]) {
      const response = await api.get(summaryOf('psc'), caller);
      expect(response.statusCode).toBe(200);
      const body = response.json<RosterSummary>();
      expect(contractErrors(okResponse(SUMMARY_PATH, 'get'), body)).toEqual([]);
      expect(body).toEqual(pscSummary());
    }
    expect((await api.get(summaryOf('kdf'), PLATFORM_ADMIN)).json()).toEqual(NONE);
  });
});

describe('import history of a record', () => {
  it('lists every import that touched the record, newest first, with its outcome', async () => {
    await givenRecord('tsc', 'TSC/0001', { state: 'onboarded' });
    const again = await importRoster(
      'tsc',
      TSC_OFFICER,
      [
        // Changes the national ID of an onboarded record: rejected, identity-locked.
        'TSC/0001,Otieno James,56789099,Teacher,C1,Kisumu Boys High School,,,',
        'TSC/0002,Njeri Ann,67890123,Deputy Principal,C2,Alliance Girls High School,,,',
      ],
      false,
    );

    const locked = await api.get(`${records('tsc')}/${recordId('TSC/0001')}`, TSC_OFFICER);
    expect(locked.json<RosterRecord>().imports).toEqual([
      { importId: again.id, startedAt: again.startedAt, outcome: 'rejected' },
      { importId: tscImport.id, startedAt: tscImport.startedAt, outcome: 'created' },
    ]);
    const updated = await api.get(`${records('tsc')}/${recordId('TSC/0002')}`, TSC_OFFICER);
    const body = updated.json<RosterRecord>();
    expect(contractErrors(okResponse(RECORD_PATH, 'get'), body)).toEqual([]);
    expect(body).toMatchObject({
      designation: 'Deputy Principal',
      lastSeenImportId: again.id,
      firstSeenImportId: tscImport.id,
      imports: [
        { importId: again.id, outcome: 'updated' },
        { importId: tscImport.id, outcome: 'created' },
      ],
    });
  });
});
