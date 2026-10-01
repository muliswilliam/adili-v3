import { PLATFORM_TENANT } from '@adili/api-kit';
import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  rosterImportBatches,
  rosterImportRows,
  rosterImports,
  rosterRecords,
} from '../../src/db/schema.js';
import {
  ImportRowsJanitor,
  purgeExpiredImportRows,
} from '../../src/roster/import/import-rows-purge.js';
import type {
  RosterImport,
  RosterImportPage,
  RosterImportPreview,
  RosterImportRowPage,
} from '../../src/roster/import/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec #27 S6 over HTTP, and the report around it: the rows of an import, the rejected rows as
 * CSV, the import history, and the purge of rows 30 days after an import ends. Imports run on
 * compose Temporal against a real Postgres, with uploads served by the in-memory adapter.
 */
const IMPORTS = '/v1/commissions/psc/roster/imports';
const ROWS_PATH = '/v1/commissions/{slug}/roster/imports/{importId}/rows';
const OFFICER: Caller = {
  sub: 'officer-psc',
  tenant: 'psc',
  roles: ['reporting-officer'],
  name: 'Fatuma Wanjiru',
};
const ADMIN: Caller = { tenant: 'psc', roles: ['commission-admin'] };
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };
const EACC_ANALYST: Caller = { tenant: 'eacc', roles: ['eacc-analyst'] };

const COLUMNS = [
  'personnel_file_number',
  'full_name',
  'national_id',
  'designation',
  'job_group',
  'reporting_entity',
  'appointment_date',
  'email',
  'phone',
];
const REASON_COLUMNS = ['row_number', 'error_fields', 'error_codes', 'error_messages'];
const HEADER = COLUMNS.join(',');
const csv = (rows: string[], header = HEADER) => [header, ...rows].join('\n') + '\n';

/** S6: every kind of bad row, between two good ones. Row numbers count the header as row 1. */
const S6_ROWS = [
  'PSC/2019/0001,Achieng Mary Otieno,23456789,Senior Officer,C3,Ministry of Health,2019-01-07,mary.otieno@example.go.ke,0712345678',
  'PSC/2019/0002,Bad National Id,12AB5678,,,,,,',
  'PSC/2019/0003,Future Appointment,30000003,,,,2099-01-01,,',
  'PSC/2019/0004,Malformed Email,30000004,,,,,mary@,',
  'PSC/2019/0005,Bad Phone,30000005,,,,,,0712',
  `${'PSC/2019/'.padEnd(30, '0')}6,File Number Too Long,30000006,,,,,,`,
  'psc/2019/0001,Duplicate File Number,30000007,,,,,,',
  'PSC/2019/0008,Duplicate National Id,2345 6789,,,,,,',
  'PSC/2019/0010,Kiprono Kipchumba,30000010,"Director, ICT",D1,State Department for ICT,,,',
];
const S6_REJECTIONS = [
  { rowNumber: 3, field: 'nationalId', code: 'format' },
  { rowNumber: 4, field: 'appointmentDate', code: 'future-date' },
  { rowNumber: 5, field: 'email', code: 'format' },
  { rowNumber: 6, field: 'phone', code: 'format' },
  { rowNumber: 7, field: 'personnelFileNumber', code: 'too-long' },
  { rowNumber: 8, field: 'personnelFileNumber', code: 'duplicate-in-file' },
  { rowNumber: 9, field: 'nationalId', code: 'duplicate-in-file' },
];

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

/** Uploads `content` for psc, imports it and waits until the import has ended. */
async function importFile(content: string, declaredComplete = false): Promise<RosterImport> {
  const uploadId = api.uploads.add('psc', { bytes: content, fileName: 'psc-roster.csv' });
  const response = await api.post(
    IMPORTS,
    { channel: 'file', uploadId, declaredComplete },
    OFFICER,
  );
  expect(response.statusCode, response.body).toBe(202);
  const { id } = response.json<RosterImport>();
  const deadline = Date.now() + 25_000;
  for (;;) {
    const body = (await api.get(`${IMPORTS}/${id}`, OFFICER)).json<RosterImport>();
    if (body.state === 'completed' || body.state === 'failed') return body;
    if (Date.now() > deadline) throw new Error(`import ${id} still ${body.state}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function asPlatform<T>(work: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, work);
}

const rowsOf = (importId: string, query = '', caller: Caller = OFFICER) =>
  api.get(`${IMPORTS}/${importId}/rows${query}`, caller);

const reportOf = (importId: string, caller: Caller = OFFICER) =>
  api.get(`${IMPORTS}/${importId}/report.csv`, caller);

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Parses the report: strips the byte order mark and splits RFC 4180 records into fields. */
function parseCsv(body: string): string[][] {
  expect(body.startsWith('\uFEFF')).toBe(true);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  const text = body.slice(1);
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\r' && text.charAt(index + 1) === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      index += 1;
    } else {
      field += char;
    }
  }
  expect(field).toBe('');
  expect(record).toEqual([]);
  return records;
}

describe('S6 mixed bad rows', () => {
  it('rejects each bad row with its field and code, applies the rest, and counts add up', async () => {
    const done = await importFile(csv(S6_ROWS));

    expect(done).toMatchObject({
      state: 'completed',
      totalRows: 9,
      processedRows: 9,
      counts: { accepted: 2, created: 2, updated: 0, unchanged: 0, rejected: 7 },
    });
    const counts = required(done.counts);
    expect(counts.accepted + counts.rejected).toBe(done.totalRows);
    expect(counts.created + counts.updated + counts.unchanged).toBe(counts.accepted);

    const rejected = await rowsOf(done.id, '?status=rejected');
    expect(rejected.statusCode, rejected.body).toBe(200);
    const page = rejected.json<RosterImportRowPage>();
    expect(contractErrors(okResponse(ROWS_PATH, 'get'), page)).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(
      page.items.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        errors: row.errors.map(({ field, code }) => ({ field, code })),
      })),
    ).toEqual(
      S6_REJECTIONS.map(({ rowNumber, field, code }) => ({
        rowNumber,
        status: 'rejected',
        errors: [{ field, code }],
      })),
    );
    expect(page.items.every((row) => row.errors[0]?.message !== '')).toBe(true);
    expect(page.items[0]).toMatchObject({
      outcome: null,
      recordId: null,
      raw: {
        personnelFileNumber: 'PSC/2019/0002',
        fullName: 'Bad National Id',
        nationalId: '12AB5678',
      },
    });

    const accepted = (await rowsOf(done.id, '?status=accepted')).json<RosterImportRowPage>();
    const records = await asPlatform((tx) =>
      tx.select().from(rosterRecords).orderBy(asc(rosterRecords.personnelFileNumber)),
    );
    expect(records.map((record) => record.personnelFileNumber)).toEqual([
      'PSC/2019/0001',
      'PSC/2019/0010',
    ]);
    expect(accepted.items.map((row) => [row.rowNumber, row.outcome, row.recordId])).toEqual([
      [2, 'created', records[0]?.id],
      [10, 'created', records[1]?.id],
    ]);

    const all = (await rowsOf(done.id)).json<RosterImportRowPage>();
    expect(all.items.map((row) => row.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('downloads exactly the rejected rows as uploaded, with the reason columns appended', async () => {
    const done = await importFile(csv(S6_ROWS));

    const response = await reportOf(done.id);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="psc-roster-rejected-rows.csv"',
    );
    const [header, ...rows] = parseCsv(response.body);
    expect(header).toEqual([...COLUMNS, ...REASON_COLUMNS]);
    expect(rows).toHaveLength(S6_REJECTIONS.length);
    expect(rows.map((row) => row.slice(9))).toEqual([
      ['3', 'national_id', 'format', 'Enter 5 to 10 digits'],
      ['4', 'appointment_date', 'future-date', 'Date is in the future'],
      ['5', 'email', 'format', 'Enter a valid email address'],
      ['6', 'phone', 'format', 'Enter a valid phone number, e.g. 0712345678 or +254712345678'],
      ['7', 'personnel_file_number', 'too-long', 'Enter 1 to 30 characters'],
      ['8', 'personnel_file_number', 'duplicate-in-file', 'Same file number as row 2'],
      ['9', 'national_id', 'duplicate-in-file', 'Same national ID as row 2'],
    ]);
    // The values are the file's own, not normalised, so the officer fixes what they sent.
    expect(rows[0]?.slice(0, 9)).toEqual([
      'PSC/2019/0002',
      'Bad National Id',
      '12AB5678',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(rows[6]?.[2]).toBe('2345 6789');
  });

  it('can be fixed and uploaded again: the reason columns are ignored', async () => {
    const done = await importFile(csv(S6_ROWS));
    const report = (await reportOf(done.id)).body;
    const uploadId = api.uploads.add('psc', { bytes: report, fileName: 'fixed.csv' });

    const preview = await api.post(`${IMPORTS}/preview`, { uploadId }, OFFICER, {
      idempotencyKey: null,
    });

    expect(preview.json<RosterImportPreview>()).toMatchObject({
      missingRequired: [],
      estimatedRows: S6_REJECTIONS.length,
      mapping: { ignored: REASON_COLUMNS, missing: [] },
    });
  });
});

describe('import rows', () => {
  it('pages by row number', async () => {
    const done = await importFile(
      csv(
        ['A/1,Jane Doe,x', 'A/2,Jane Doe,x', 'A/3,Jane Doe,x', 'A/4,Jane Doe,x', 'A/5,Jane Doe,x'],
        'personnel_file_number,full_name,national_id',
      ),
    );

    const first = (await rowsOf(done.id, '?status=rejected&limit=2')).json<RosterImportRowPage>();
    const second = (
      await rowsOf(done.id, `?status=rejected&limit=2&cursor=${first.nextCursor ?? ''}`)
    ).json<RosterImportRowPage>();
    const third = (
      await rowsOf(done.id, `?status=rejected&limit=2&cursor=${second.nextCursor ?? ''}`)
    ).json<RosterImportRowPage>();

    expect(first.items.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(second.items.map((row) => row.rowNumber)).toEqual([4, 5]);
    expect(third.items.map((row) => row.rowNumber)).toEqual([6]);
    expect(third.nextCursor).toBeNull();
  });

  it('answers 400 for an unknown cursor or status and a limit out of range', async () => {
    const done = await importFile(csv(S6_ROWS));

    for (const query of ['?cursor=nope', '?status=applied', '?limit=0', '?limit=201']) {
      const response = await rowsOf(done.id, query);
      expect(response.statusCode, query).toBe(400);
    }
  });

  it("shows rows and the report to the Commission's staff and the platform admin only", async () => {
    const done = await importFile(csv(S6_ROWS));

    for (const caller of [ADMIN, PLATFORM_ADMIN]) {
      expect((await rowsOf(done.id, '', caller)).statusCode).toBe(200);
      expect((await reportOf(done.id, caller)).statusCode).toBe(200);
    }
    // Rows hold personal data, which EACC never sees (spec #27 story 7).
    for (const caller of [EACC_ANALYST, { tenant: 'eacc', roles: ['eacc-supervisor'] }]) {
      expect((await rowsOf(done.id, '', caller)).statusCode).toBe(403);
      expect((await reportOf(done.id, caller)).statusCode).toBe(403);
    }
    const otherOfficer = { ...OFFICER, tenant: 'tsc' };
    expect((await rowsOf(done.id, '', otherOfficer)).statusCode).toBe(404);
    expect((await reportOf(done.id, otherOfficer)).statusCode).toBe(404);
    expect((await rowsOf(randomUUID())).statusCode).toBe(404);
    expect((await reportOf(randomUUID())).statusCode).toBe(404);
    expect(
      (await api.get(`/v1/commissions/tsc/roster/imports/${done.id}/rows`, PLATFORM_ADMIN))
        .statusCode,
    ).toBe(404);
    expect((await rowsOf(done.id, '', { tenant: 'psc', roles: ['reviewer'] })).statusCode).toBe(
      403,
    );
  });
});

describe('rejected rows report', () => {
  it('includes rows rejected when applied, for an onboarded identity', async () => {
    await importFile(csv([S6_ROWS[0] ?? '']));
    await asPlatform((tx) => tx.update(rosterRecords).set({ state: 'onboarded' }));

    const done = await importFile(csv([(S6_ROWS[0] ?? '').replace('23456789', '99887766')]));

    const [, row] = parseCsv((await reportOf(done.id)).body);
    expect(row?.slice(2, 3)).toEqual(['99887766']);
    expect(row?.slice(9, 12)).toEqual(['2', 'national_id', 'identity-locked']);
  });

  it('streams large reports page by page, one line per rejected row', async () => {
    const rows = Array.from(
      { length: 2_500 },
      (_, index) => `PSC/${index},Officer Number ${index},bad-${index}`,
    );
    const done = await importFile(csv(rows, 'personnel_file_number,full_name,national_id'));
    expect(done.counts?.rejected).toBe(2_500);

    const response = await reportOf(done.id);

    expect(response.headers['content-length']).toBeUndefined();
    const [, ...lines] = parseCsv(response.body);
    expect(lines).toHaveLength(2_500);
    expect(lines.map((line) => line[9])).toEqual(rows.map((_, index) => String(index + 2)));
  });

  it('keeps spreadsheet formulas from running, without mangling phone numbers', async () => {
    const done = await importFile(
      csv([
        'PSC/1,"=HYPERLINK(""http://x.test"")",bad,,,,,,+254 712 000 001',
        'PSC/2,-2+3+cmd|calc,bad,,,,,,',
      ]),
    );

    const [, first, second] = parseCsv((await reportOf(done.id)).body);

    expect(first?.[1]).toBe(`'=HYPERLINK("http://x.test")`);
    expect(first?.[8]).toBe('+254 712 000 001');
    expect(second?.[1]).toBe(`'-2+3+cmd|calc`);
  });

  it('is empty but for the header when nothing was rejected, and named after the import', async () => {
    const done = await importFile(csv([S6_ROWS[0] ?? '']));
    await asPlatform((tx) =>
      tx
        .update(rosterImports)
        .set({ fileName: 'Roster (final) Ω.xlsx' })
        .where(eq(rosterImports.id, done.id)),
    );

    const response = await reportOf(done.id);

    expect(parseCsv(response.body)).toEqual([[...COLUMNS, ...REASON_COLUMNS]]);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="Roster-final-rejected-rows.csv"',
    );
  });
});

describe('import history', () => {
  it("lists the Commission's imports newest first, a page at a time", async () => {
    const first = await importFile(csv([S6_ROWS[0] ?? '']), true);
    const second = await importFile(csv(S6_ROWS));
    const third = await importFile(csv(['PSC/1,Jane Doe'], 'personnel_file_number,full_name'));
    await asPlatform((tx) =>
      tx.insert(rosterImports).values({
        tenant: 'tsc',
        channel: 'file',
        declaredComplete: false,
        format: 'csv',
        startedByKind: 'user',
        startedBy: 'officer-tsc',
      }),
    );

    const response = await api.get(`${IMPORTS}?limit=2`, OFFICER);

    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<RosterImportPage>();
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/roster/imports', 'get'), page),
    ).toEqual([]);
    expect(page.items.map((item) => item.id)).toEqual([third.id, second.id]);
    expect(page.items[0]).toMatchObject({
      channel: 'file',
      declaredComplete: false,
      state: 'failed',
      failure: { code: 'missing-columns' },
      startedBy: { kind: 'user', id: 'officer-psc', name: 'Fatuma Wanjiru' },
    });
    expect(page.items[1]).toMatchObject({ state: 'completed', counts: { rejected: 7 } });

    const next = (
      await api.get(`${IMPORTS}?limit=2&cursor=${page.nextCursor ?? ''}`, OFFICER)
    ).json<RosterImportPage>();
    expect(next.items.map((item) => item.id)).toEqual([first.id]);
    expect(next.items[0]).toMatchObject({ declaredComplete: true });
    expect(next.nextCursor).toBeNull();
  });

  it('is visible to national readers and 404 to other Commissions', async () => {
    const done = await importFile(csv([S6_ROWS[0] ?? '']));

    for (const caller of [ADMIN, PLATFORM_ADMIN, EACC_ANALYST]) {
      const response = await api.get(IMPORTS, caller);
      expect(response.statusCode, JSON.stringify(caller)).toBe(200);
      expect(response.json<RosterImportPage>().items.map((item) => item.id)).toEqual([done.id]);
    }
    expect((await api.get(IMPORTS, { ...OFFICER, tenant: 'tsc' })).statusCode).toBe(404);
    expect((await api.get(IMPORTS, { tenant: 'psc', roles: ['reviewer'] })).statusCode).toBe(403);
    expect((await api.get(`${IMPORTS}?cursor=nope`, OFFICER)).statusCode).toBe(400);
    expect(
      (await api.get('/v1/commissions/tsc/roster/imports', EACC_ANALYST)).json<RosterImportPage>()
        .items,
    ).toEqual([]);
  });
});

describe('row retention', () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function endedDaysAgo(importId: string, days: number): Promise<void> {
    const at = new Date(Date.now() - days * DAY);
    await asPlatform((tx) =>
      tx
        .update(rosterImports)
        .set({ startedAt: at, completedAt: at })
        .where(eq(rosterImports.id, importId)),
    );
  }

  const stagedRows = (importId: string) =>
    asPlatform((tx) =>
      tx.select().from(rosterImportRows).where(eq(rosterImportRows.importId, importId)),
    );

  it('says until when the rows are kept: 30 days after the import ended', async () => {
    const done = await importFile(csv(S6_ROWS));

    expect(new Date(required(done.rowsRetainedUntil)).getTime()).toBe(
      new Date(required(done.completedAt)).getTime() + 30 * DAY,
    );
  });

  it('purges the rows of imports that ended over 30 days ago, and keeps the import', async () => {
    const old = await importFile(csv(S6_ROWS));
    const recent = await importFile(csv(S6_ROWS));
    await endedDaysAgo(old.id, 31);
    await endedDaysAgo(recent.id, 29);
    const [inserted] = await asPlatform((tx) =>
      tx
        .insert(rosterImports)
        .values({
          tenant: 'tsc',
          channel: 'file',
          declaredComplete: false,
          format: 'csv',
          state: 'processing',
          startedAt: new Date(Date.now() - 40 * DAY),
          startedByKind: 'user',
          startedBy: 'officer-tsc',
        })
        .returning(),
    );
    const running = required(inserted);
    await asPlatform((tx) =>
      tx.insert(rosterImportRows).values({
        importId: running.id,
        rowNumber: 2,
        tenant: 'tsc',
        raw: { personnelFileNumber: 'TSC/1' },
        status: 'rejected',
      }),
    );

    const purged = await purgeExpiredImportRows(api.db, { batchSize: 4 });

    expect(purged).toBe(9);
    expect(await stagedRows(old.id)).toEqual([]);
    expect(await stagedRows(recent.id)).toHaveLength(9);
    expect(await stagedRows(running.id)).toHaveLength(1);
    // The import and its counts stay in the history.
    const kept = (await api.get(`${IMPORTS}/${old.id}`, OFFICER)).json<RosterImport>();
    expect(kept).toMatchObject({ state: 'completed', counts: { rejected: 7 } });
    expect(await purgeExpiredImportRows(api.db)).toBe(0);
  });

  it('purges an API batch left behind by an import that never ended, 30 days after it started', async () => {
    const stuck = async (tenant: string, daysAgo: number) => {
      const [inserted] = await asPlatform((tx) =>
        tx
          .insert(rosterImports)
          .values({
            tenant,
            channel: 'api',
            declaredComplete: false,
            format: 'json',
            state: 'processing',
            startedAt: new Date(Date.now() - daysAgo * DAY),
            startedByKind: 'client',
            startedBy: `roster-${tenant}-0a1b2c3d`,
          })
          .returning({ id: rosterImports.id }),
      );
      const importId = required(inserted).id;
      await asPlatform((tx) =>
        tx.insert(rosterImportBatches).values({
          importId,
          tenant,
          rows: [{ personnelFileNumber: 'X/1', fullName: 'Achieng Otieno' }],
        }),
      );
      return importId;
    };
    const old = await stuck('psc', 31);
    const recent = await stuck('tsc', 29);

    expect(await purgeExpiredImportRows(api.db)).toBe(1);
    const left = await asPlatform((tx) =>
      tx.select({ importId: rosterImportBatches.importId }).from(rosterImportBatches),
    );
    expect(left).toEqual([{ importId: recent }]);
    expect(left).not.toContainEqual({ importId: old });
  });

  it('answers 410 for the rows and report of an import past its retention', async () => {
    const done = await importFile(csv(S6_ROWS));
    await endedDaysAgo(done.id, 31);

    for (const response of [await rowsOf(done.id), await reportOf(done.id)]) {
      expect(response.statusCode).toBe(410);
      expect(response.json<Problem>().type).toBe('import-rows-purged');
    }
  });

  it('runs as a janitor in the service', () => {
    expect(api.app.get(ImportRowsJanitor)).toBeInstanceOf(ImportRowsJanitor);
  });
});
