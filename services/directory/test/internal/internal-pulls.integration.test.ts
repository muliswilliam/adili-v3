import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import type { TenantPolicyVersion } from '../../src/commissions/policy-representation.js';
import type { PersonContacts } from '../../src/persons/representation.js';
import type { ExitsResult } from '../../src/roster/exits/representation.js';
import type { RosterImport } from '../../src/roster/import/representation.js';
import type {
  InternalRosterRecord,
  InternalRosterRecordPage,
  RosterNationalId,
  RosterRecordPage,
} from '../../src/roster/records/representation.js';
import { todayInNairobi } from '../../src/roster/row-validation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenOnboardedPerson, givenRoster } from '../support/onboarding.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec 04 S18 over HTTP: the internal pulls other services make after a directory event (records
 * touched by an import or an exit batch, one record, the current policy) and the verified
 * contacts of a person. Callers are services with `directory:internal`, acting for a tenant in
 * X-Acting-Tenant; anything of another tenant is 404. Imports run on compose Temporal.
 */

const PSC_ROSTER = '/v1/commissions/psc/roster';
const INTERNAL_RECORDS = '/internal/v1/commissions/psc/roster/records';
const OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };
/** The declarations service's client credentials token. */
const DECLARATIONS: Caller = {
  sub: 'service-account-declarations',
  azp: 'declarations',
  scope: 'profile directory:internal',
};
/** The notifications service's client credentials token. */
const NOTIFICATIONS: Caller = {
  sub: 'service-account-notifications',
  azp: 'notifications',
  scope: 'profile directory:person-contacts',
};
/** The review service's client credentials token. */
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'profile directory:internal directory:roster-national-id',
};
const ACTING_PSC = { 'x-acting-tenant': 'psc' };

const HEADER = 'personnel_file_number,full_name,national_id,designation,appointment_date';
const ROW = {
  achieng: 'PSC/0001,Achieng Otieno,12345678,Officer,2025-03-10',
  kiprono: 'PSC/0002,Kiprono Kipchumba,23456789,Officer,',
  wanjiru: 'PSC/0003,Wanjiru Kamau,34567890,Senior Officer,2019-07-01',
};
const csv = (rows: string[]) => [HEADER, ...rows].join('\n') + '\n';

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

/** Imports `rows` for psc through the import endpoints and waits for the import to complete. */
async function importRoster(rows: string[], declaredComplete = false): Promise<RosterImport> {
  const uploadId = api.uploads.add('psc', { bytes: csv(rows), fileName: 'psc.csv' });
  const started = await api.post(
    `${PSC_ROSTER}/imports`,
    { channel: 'file', uploadId, declaredComplete },
    OFFICER,
  );
  expect(started.statusCode, started.body).toBe(202);
  const { id } = started.json<RosterImport>();
  const deadline = Date.now() + 25_000;
  for (;;) {
    const response = await api.get(`${PSC_ROSTER}/imports/${id}`, OFFICER);
    const body = response.json<RosterImport>();
    if (body.state === 'completed') return body;
    if (body.state === 'failed' || Date.now() > deadline) {
      throw new Error(`import ${id} did not complete: ${response.body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function recordIds(): Promise<Map<string, string>> {
  const response = await api.get(`${PSC_ROSTER}/records?limit=200`, OFFICER);
  const items = response.json<RosterRecordPage>().items;
  return new Map(items.map((item) => [item.personnelFileNumber, item.id]));
}

function idOf(ids: Map<string, string>, fileNumber: string): string {
  const id = ids.get(fileNumber);
  if (!id) throw new Error(`no record ${fileNumber}`);
  return id;
}

function daysAgo(days: number): string {
  const date = new Date(`${todayInNairobi()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Every page of a pull, following `nextCursor`; each page must match the contract. */
async function pullAll(query: string, limit: number): Promise<InternalRosterRecordPage[]> {
  const pages: InternalRosterRecordPage[] = [];
  let cursor: string | null = null;
  do {
    const url = `${INTERNAL_RECORDS}?${query}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await api.get(url, DECLARATIONS, ACTING_PSC);
    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<InternalRosterRecordPage>();
    expect(
      contractErrors(okResponse('/internal/v1/commissions/{slug}/roster/records', 'get'), page),
    ).toEqual([]);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null && pages.length < 10);
  return pages;
}

const auditReads = async () =>
  (await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox))
    .filter((event) => event.type === 'audit.read.v1')
    .map((event) => event.envelope.data);

describe('S18 records touched by an import', () => {
  it('pages through them in cursor order with dates, person and onboarding', async () => {
    const first = await importRoster([ROW.achieng, ROW.kiprono, ROW.wanjiru]);
    const ids = await recordIds();
    const onboardedAt = new Date('2026-09-20T08:00:00Z');
    const person = await givenOnboardedPerson(api, {
      recordIds: [idOf(ids, 'PSC/0003')],
      onboardedAt,
    });

    const pages = await pullAll(`importId=${first.id}`, 2);

    expect(pages.map((page) => page.items.length)).toEqual([2, 1]);
    expect(pages.at(-1)?.nextCursor).toBeNull();
    const items = pages.flatMap((page) => page.items);
    expect(items.map((item) => item.personnelFileNumber)).toEqual([
      'PSC/0001',
      'PSC/0002',
      'PSC/0003',
    ]);
    expect(items[0]).toEqual({
      id: idOf(ids, 'PSC/0001'),
      tenant: 'psc',
      personnelFileNumber: 'PSC/0001',
      fullName: 'Achieng Otieno',
      designation: 'Officer',
      jobGroup: null,
      reportingEntity: null,
      state: 'not_onboarded',
      appointmentDate: '2025-03-10',
      exitDate: null,
      personId: null,
      ofr: null,
      onboardedAt: null,
      updatedAt: expect.any(String) as string,
    } satisfies InternalRosterRecord);
    expect(items[1]).toMatchObject({ appointmentDate: null });
    expect(items[2]).toMatchObject({
      state: 'onboarded',
      appointmentDate: '2019-07-01',
      personId: person.personId,
      ofr: person.ofr,
      onboardedAt: onboardedAt.toISOString(),
    });
  });

  it('gives only the records a later import had rows for, and 1,000 per page by default', async () => {
    await importRoster([ROW.achieng, ROW.kiprono, ROW.wanjiru]);
    const second = await importRoster([ROW.kiprono.replace('Officer', 'Principal Officer')]);

    const response = await api.get(`${INTERNAL_RECORDS}?importId=${second.id}`, DECLARATIONS, {
      ...ACTING_PSC,
    });

    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<InternalRosterRecordPage>();
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => [item.personnelFileNumber, item.designation])).toEqual([
      ['PSC/0002', 'Principal Officer'],
    ]);
  });

  it("answers 404 for an unknown import and for another Commission's", async () => {
    await importRoster([ROW.achieng]);
    const tscImport = (await givenRosterImportOf('tsc')).importId;

    const unknown = await api.get(
      `${INTERNAL_RECORDS}?importId=${randomUUID()}`,
      DECLARATIONS,
      ACTING_PSC,
    );
    const otherTenant = await api.get(
      `${INTERNAL_RECORDS}?importId=${tscImport}`,
      DECLARATIONS,
      ACTING_PSC,
    );

    expect(unknown.statusCode).toBe(404);
    expect(otherTenant.statusCode).toBe(404);
  });

  it.each([
    ['none of importId, exitBatchId and search', ''],
    ['both importId and exitBatchId', `importId=${randomUUID()}&exitBatchId=${randomUUID()}`],
    ['an unknown cursor', `importId=${randomUUID()}&cursor=nonsense`],
    ['a limit above 1,000', `importId=${randomUUID()}&limit=1001`],
  ])('answers 400 for %s', async (_case, query) => {
    const response = await api.get(`${INTERNAL_RECORDS}?${query}`, DECLARATIONS, ACTING_PSC);

    expect(response.statusCode, response.body).toBe(400);
  });

  it('records the pull in the audit trail as the calling service', async () => {
    const first = await importRoster([ROW.achieng]);

    await api.get(`${INTERNAL_RECORDS}?importId=${first.id}`, DECLARATIONS, ACTING_PSC);

    expect(await auditReads()).toContainEqual(
      expect.objectContaining({
        action: 'roster.records.pulled',
        actor: expect.objectContaining({ clientId: 'declarations' }) as unknown,
      }),
    );
  });
});

describe('S18 records of an exit batch', () => {
  it('gives the exited records with their exit dates, paged', async () => {
    await importRoster([ROW.achieng, ROW.kiprono, ROW.wanjiru]);
    const ids = await recordIds();
    const exitDate = daysAgo(3);
    const confirmed = await api.post(
      `${PSC_ROSTER}/exits`,
      {
        records: [
          { recordId: idOf(ids, 'PSC/0003') },
          { recordId: idOf(ids, 'PSC/0001'), exitDate: daysAgo(5) },
        ],
        exitDate,
      },
      OFFICER,
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const { batchId } = confirmed.json<ExitsResult>();
    const other = await api.post(
      `${PSC_ROSTER}/exits`,
      { records: [{ recordId: idOf(ids, 'PSC/0002') }], exitDate },
      OFFICER,
    );
    expect(other.statusCode, other.body).toBe(200);

    const pages = await pullAll(`exitBatchId=${batchId}`, 1);

    const items = pages.flatMap((page) => page.items);
    expect(
      items.map((item) => [item.personnelFileNumber, item.state, item.exitDate]).sort(),
    ).toEqual([
      ['PSC/0001', 'exited', daysAgo(5)],
      ['PSC/0003', 'exited', exitDate],
    ]);
    expect(pages).toHaveLength(2);
  });

  it("answers 404 for an unknown batch and for another Commission's", async () => {
    const tscIds = await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/1', fullName: 'Otieno Ouma', nationalId: '56789012' },
    ]);
    const tscOfficer: Caller = { sub: 'officer-tsc', tenant: 'tsc', roles: ['reporting-officer'] };
    const tscExit = await api.post(
      '/v1/commissions/tsc/roster/exits',
      { records: [{ recordId: idOf(tscIds, 'TSC/1') }], exitDate: daysAgo(1) },
      tscOfficer,
    );
    expect(tscExit.statusCode, tscExit.body).toBe(200);

    const unknown = await api.get(
      `${INTERNAL_RECORDS}?exitBatchId=${randomUUID()}`,
      DECLARATIONS,
      ACTING_PSC,
    );
    const otherTenant = await api.get(
      `${INTERNAL_RECORDS}?exitBatchId=${tscExit.json<ExitsResult>().batchId}`,
      DECLARATIONS,
      ACTING_PSC,
    );

    expect(unknown.statusCode).toBe(404);
    expect(otherTenant.statusCode).toBe(404);
  });
});

describe('Spec 10 roster search (officer resolution)', () => {
  /** The access service's client credentials token. */
  const ACCESS: Caller = {
    sub: 'service-account-access',
    azp: 'access',
    scope: 'profile directory:internal',
  };

  const search = (query: string, headers: Record<string, string> = ACTING_PSC) =>
    api.get(`${INTERNAL_RECORDS}?${query}`, ACCESS, headers);

  async function givenPscRoster() {
    const ids = await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/0101', fullName: 'Anne Njeri Mutua', nationalId: '11223344' },
      { personnelFileNumber: 'PSC/0102', fullName: 'Peter Njeru Kamande', nationalId: '22334455' },
      { personnelFileNumber: 'HR/77', fullName: 'Grace Wanjiru', nationalId: '33445566' },
    ]);
    await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/0101', fullName: 'Anne Njeri Otieno', nationalId: '44556677' },
    ]);
    return ids;
  }

  it('finds records by part of the name, case-insensitive, ordered by full name, with their person', async () => {
    const ids = await givenPscRoster();
    const person = await givenOnboardedPerson(api, { recordIds: [idOf(ids, 'PSC/0101')] });

    const response = await search('search=NJER');

    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<InternalRosterRecordPage>();
    expect(
      contractErrors(okResponse('/internal/v1/commissions/{slug}/roster/records', 'get'), page),
    ).toEqual([]);
    expect(page.items.map((item) => [item.fullName, item.personId])).toEqual([
      ['Anne Njeri Mutua', person.personId],
      ['Peter Njeru Kamande', null],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('finds records by the beginning of the personnel file number', async () => {
    await givenPscRoster();

    const page = (await search('search=psc%2F010')).json<InternalRosterRecordPage>();
    const none = (await search('search=0101')).json<InternalRosterRecordPage>();

    expect(page.items.map((item) => item.personnelFileNumber)).toEqual(['PSC/0101', 'PSC/0102']);
    expect(none.items).toEqual([]);
  });

  it("does not search by national ID, and never shows another Commission's records", async () => {
    await givenPscRoster();

    const byNationalId = (await search('search=11223344')).json<InternalRosterRecordPage>();
    const anne = (await search('search=Anne')).json<InternalRosterRecordPage>();

    expect(byNationalId.items).toEqual([]);
    expect(anne.items.map((item) => item.tenant)).toEqual(['psc']);
  });

  it('pages by full name with the cursor', async () => {
    await givenPscRoster();

    const first = (await search('search=an&limit=2')).json<InternalRosterRecordPage>();
    const second = (
      await search(`search=an&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
    ).json<InternalRosterRecordPage>();

    expect(first.items.map((item) => item.fullName)).toEqual(['Anne Njeri Mutua', 'Grace Wanjiru']);
    expect(second.items.map((item) => item.fullName)).toEqual(['Peter Njeru Kamande']);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ['a search of one character', 'search=a%20'],
    ['a search with an import', `search=anne&importId=${randomUUID()}`],
    ['a limit above 50', 'search=anne&limit=51'],
    [
      'a cursor of an import pull',
      `search=anne&cursor=${Buffer.from('["row",1]').toString('base64url')}`,
    ],
  ])('answers 400 for %s', async (_case, query) => {
    const response = await search(query);

    expect(response.statusCode, response.body).toBe(400);
  });

  it('records the search in the audit trail as the calling service', async () => {
    await givenPscRoster();

    await search('search=anne');

    expect(await auditReads()).toContainEqual(
      expect.objectContaining({
        action: 'roster.records.pulled',
        actor: expect.objectContaining({ clientId: 'access' }) as unknown,
      }),
    );
  });
});

describe('S18 one record', () => {
  it('gives the record as the pulls do', async () => {
    const ids = await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/9', fullName: 'Mary Wambui', nationalId: '45678901' },
    ]);
    const person = await givenOnboardedPerson(api, { recordIds: [idOf(ids, 'PSC/9')] });

    const response = await api.get(
      `${INTERNAL_RECORDS}/${idOf(ids, 'PSC/9')}`,
      DECLARATIONS,
      ACTING_PSC,
    );

    expect(response.statusCode, response.body).toBe(200);
    const record = response.json<InternalRosterRecord>();
    expect(
      contractErrors(
        okResponse('/internal/v1/commissions/{slug}/roster/records/{recordId}', 'get'),
        record,
      ),
    ).toEqual([]);
    expect(record).toMatchObject({
      id: idOf(ids, 'PSC/9'),
      tenant: 'psc',
      state: 'onboarded',
      personId: person.personId,
      ofr: person.ofr,
    });
  });

  it("answers 404 for another Commission's record, and when acting for another tenant", async () => {
    const tscIds = await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/1', fullName: 'Otieno Ouma', nationalId: '56789012' },
    ]);
    const tscRecord = idOf(tscIds, 'TSC/1');

    const viaPsc = await api.get(`${INTERNAL_RECORDS}/${tscRecord}`, DECLARATIONS, ACTING_PSC);
    const actingForPsc = await api.get(
      `/internal/v1/commissions/tsc/roster/records/${tscRecord}`,
      DECLARATIONS,
      ACTING_PSC,
    );
    const actingForTsc = await api.get(
      `/internal/v1/commissions/tsc/roster/records/${tscRecord}`,
      DECLARATIONS,
      { 'x-acting-tenant': 'tsc' },
    );

    expect(viaPsc.statusCode).toBe(404);
    expect(actingForPsc.statusCode).toBe(404);
    expect(actingForTsc.statusCode).toBe(200);
  });
});

describe("S6 a roster record's national ID (spec 08)", () => {
  async function givenRecord(): Promise<string> {
    const ids = await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/9', fullName: 'Mary Wambui', nationalId: '45678901' },
    ]);
    return idOf(ids, 'PSC/9');
  }

  it('gives the national ID the roster has, kept off the record the pulls give', async () => {
    const recordId = await givenRecord();

    const response = await api.get(
      `${INTERNAL_RECORDS}/${recordId}/national-id`,
      REVIEW,
      ACTING_PSC,
    );
    const record = await api.get(`${INTERNAL_RECORDS}/${recordId}`, REVIEW, ACTING_PSC);

    expect(response.statusCode, response.body).toBe(200);
    const found = response.json<RosterNationalId>();
    expect(
      contractErrors(
        okResponse('/internal/v1/commissions/{slug}/roster/records/{recordId}/national-id', 'get'),
        found,
      ),
    ).toEqual([]);
    expect(found).toEqual({ nationalId: '45678901' });
    expect(record.body).not.toContain('45678901');
  });

  it('records the read in the audit trail as the calling service', async () => {
    const recordId = await givenRecord();

    await api.get(`${INTERNAL_RECORDS}/${recordId}/national-id`, REVIEW, ACTING_PSC);

    expect(await auditReads()).toContainEqual(
      expect.objectContaining({
        action: 'roster.record.national-id.read',
        resource: expect.objectContaining({ params: { slug: 'psc', recordId } }) as unknown,
        actor: expect.objectContaining({ clientId: 'review' }) as unknown,
      }),
    );
  });

  it('refuses service tokens with directory:internal only, and user tokens', async () => {
    const recordId = await givenRecord();
    const url = `${INTERNAL_RECORDS}/${recordId}/national-id`;

    expect((await api.get(url, DECLARATIONS, ACTING_PSC)).statusCode).toBe(403);
    expect((await api.get(url, OFFICER, ACTING_PSC)).statusCode).toBe(403);
  });

  it("answers 404 for another Commission's record and an unknown one, 400 for a bad id", async () => {
    const tscIds = await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/1', fullName: 'Otieno Ouma', nationalId: '56789012' },
    ]);
    const tscRecord = idOf(tscIds, 'TSC/1');

    const viaPsc = await api.get(
      `${INTERNAL_RECORDS}/${tscRecord}/national-id`,
      REVIEW,
      ACTING_PSC,
    );
    const actingForPsc = await api.get(
      `/internal/v1/commissions/tsc/roster/records/${tscRecord}/national-id`,
      REVIEW,
      ACTING_PSC,
    );
    const unknown = await api.get(
      `${INTERNAL_RECORDS}/${randomUUID()}/national-id`,
      REVIEW,
      ACTING_PSC,
    );
    const invalid = await api.get(`${INTERNAL_RECORDS}/not-a-uuid/national-id`, REVIEW, ACTING_PSC);

    expect(viaPsc.statusCode).toBe(404);
    expect(actingForPsc.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
  });
});

describe('Commission staff by role (spec 09 reminders and chase)', () => {
  const STAFF = '/internal/v1/commissions/psc/staff';
  /** The reporting service's client credentials token. */
  const REPORTING: Caller = {
    sub: 'service-account-reporting',
    azp: 'reporting',
    scope: 'profile directory:internal',
  };

  function staff(role: string, caller: Caller = REPORTING, acting = ACTING_PSC) {
    return api.get(`${STAFF}?role=${role}`, caller, acting);
  }

  it('lists the enabled accounts holding the role with a verified email, audited', async () => {
    const supervisor = api.identity.seedUser({
      email: 'supervisor@psc.go.ke',
      tenant: 'psc',
      roles: ['supervisor'],
      emailVerified: true,
    });
    api.identity.seedUser({
      email: 'never.activated@psc.go.ke',
      tenant: 'psc',
      roles: ['supervisor'],
    });
    api.identity.seedUser({
      email: 'disabled@psc.go.ke',
      tenant: 'psc',
      roles: ['supervisor'],
      emailVerified: true,
      enabled: false,
    });
    api.identity.seedUser({
      email: 'supervisor@tsc.go.ke',
      tenant: 'tsc',
      roles: ['supervisor'],
      emailVerified: true,
    });
    const admin = api.identity.seedUser({
      email: 'admin@psc.go.ke',
      tenant: 'psc',
      roles: ['commission-admin'],
      emailVerified: true,
    });

    const response = await staff('supervisor');

    expect(response.statusCode, response.body).toBe(200);
    expect(
      contractErrors(okResponse('/internal/v1/commissions/{slug}/staff', 'get'), response.json()),
    ).toEqual([]);
    expect(response.json()).toEqual({
      items: [{ subject: supervisor, email: 'supervisor@psc.go.ke' }],
    });
    expect((await staff('commission-admin')).json()).toEqual({
      items: [{ subject: admin, email: 'admin@psc.go.ke' }],
    });
    expect(await auditReads()).toContainEqual(
      expect.objectContaining({
        action: 'commission.staff.pulled',
        resource: expect.objectContaining({ type: 'staff-account', ids: [supervisor] }) as unknown,
      }),
    );
  });

  it("lists the Commission's access officers, for access's officer reminders", async () => {
    const officer = api.identity.seedUser({
      email: 'access.officer@psc.go.ke',
      tenant: 'psc',
      roles: ['access-officer'],
      emailVerified: true,
    });
    api.identity.seedUser({
      email: 'access.officer@tsc.go.ke',
      tenant: 'tsc',
      roles: ['access-officer'],
      emailVerified: true,
    });
    const access: Caller = {
      sub: 'service-account-access',
      azp: 'access',
      scope: 'profile directory:internal',
    };

    const response = await staff('access-officer', access);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      items: [{ subject: officer, email: 'access.officer@psc.go.ke' }],
    });
  });

  it('takes the staff roles only; 404 for another Commission; refuses user tokens', async () => {
    expect((await staff('declarant')).statusCode).toBe(400);
    expect((await staff('supervisor', REPORTING, { 'x-acting-tenant': 'tsc' })).statusCode).toBe(
      404,
    );
    expect((await staff('supervisor', OFFICER)).statusCode).toBe(403);
  });
});

describe('Commission reference', () => {
  it('gives the slug, issuer code and name services show the Commission by', async () => {
    const response = await api.get('/internal/v1/commissions/psc', DECLARATIONS, ACTING_PSC);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<unknown>();
    expect(contractErrors(okResponse('/internal/v1/commissions/{slug}', 'get'), body)).toEqual([]);
    expect(body).toEqual({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' });
  });

  it('lists every Commission by slug, with no tenant to act for', async () => {
    const response = await api.get('/internal/v1/commissions', DECLARATIONS);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<unknown>();
    expect(contractErrors(okResponse('/internal/v1/commissions', 'get'), body)).toEqual([]);
    expect(body).toEqual({
      items: [
        {
          slug: 'psc',
          issuerCode: 'PSC',
          name: 'Public Service Commission',
          status: 'active',
          obligationsStartDate: todayInNairobi(),
        },
        {
          slug: 'tsc',
          issuerCode: 'TSC',
          name: 'Teachers Service Commission',
          status: 'active',
          obligationsStartDate: todayInNairobi(),
        },
      ],
    });
  });

  it("gives each Commission's earliest obligations-start date over its policy versions", async () => {
    const admin: Caller = { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] };
    const moved = await api.post(
      '/v1/commissions/psc/policy/versions',
      { obligationsStartDate: '2031-07-01' },
      admin,
    );
    expect(moved.statusCode, moved.body).toBe(201);

    const response = await api.get('/internal/v1/commissions', DECLARATIONS);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ items: unknown[] }>().items[0]).toMatchObject({
      slug: 'psc',
      obligationsStartDate: todayInNairobi(),
    });
  });

  it('refuses the list to user tokens and to other scopes', async () => {
    const user = await api.get('/internal/v1/commissions', {
      sub: 'admin-1',
      tenant: 'platform',
      roles: ['platform-admin'],
    });
    const other = await api.get('/internal/v1/commissions', NOTIFICATIONS);

    expect(user.statusCode).toBe(403);
    expect(other.statusCode).toBe(403);
  });

  it("answers 404 for another Commission's and for an unknown one", async () => {
    const other = await api.get('/internal/v1/commissions/tsc', DECLARATIONS, ACTING_PSC);
    const unknown = await api.get('/internal/v1/commissions/kra', DECLARATIONS, {
      'x-acting-tenant': 'kra',
    });

    expect(other.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });
});

describe('S18 current policy', () => {
  it('gives version 1 with the obligations-start date, periods and offsets', async () => {
    const response = await api.get('/internal/v1/commissions/psc/policy', DECLARATIONS, ACTING_PSC);

    expect(response.statusCode, response.body).toBe(200);
    const policy = response.json<TenantPolicyVersion>();
    expect(
      contractErrors(okResponse('/internal/v1/commissions/{slug}/policy', 'get'), policy),
    ).toEqual([]);
    expect(policy).toMatchObject({
      version: 1,
      obligationsStartDate: todayInNairobi(),
      initialDueAfterAppointmentDays: 30,
      biennial: { statementDate: '11-01', dueDate: '12-31' },
      finalDueAfterExitDays: 30,
      reminderOffsetsDays: [30, 14, 7],
    });
  });

  it("answers 404 for another Commission's policy", async () => {
    const response = await api.get('/internal/v1/commissions/tsc/policy', DECLARATIONS, ACTING_PSC);

    expect(response.statusCode).toBe(404);
  });
});

describe('S18 person contacts', () => {
  async function givenPerson(contacts: { email: string | null; phone: string | null }) {
    const ids = await givenRoster(api, 'psc', [
      {
        personnelFileNumber: `PSC/${randomUUID().slice(0, 6)}`,
        fullName: 'Mary Wambui',
        nationalId: '45678901',
      },
    ]);
    return givenOnboardedPerson(api, { recordIds: [...ids.values()], ...contacts });
  }

  it('gives the verified email and phone', async () => {
    const person = await givenPerson({ email: 'mary@example.go.ke', phone: '+254712345678' });

    const response = await api.get(
      `/internal/v1/persons/${person.personId}/contacts`,
      NOTIFICATIONS,
      ACTING_PSC,
    );

    expect(response.statusCode, response.body).toBe(200);
    const contacts = response.json<PersonContacts>();
    expect(
      contractErrors(okResponse('/internal/v1/persons/{personId}/contacts', 'get'), contacts),
    ).toEqual([]);
    expect(contacts).toEqual({
      personId: person.personId,
      email: 'mary@example.go.ke',
      phone: '+254712345678',
    });
  });

  it('gives nulls where the person has no verified contact', async () => {
    const person = await givenPerson({ email: null, phone: null });

    const response = await api.get(
      `/internal/v1/persons/${person.personId}/contacts`,
      NOTIFICATIONS,
      ACTING_PSC,
    );

    expect(response.json<PersonContacts>()).toEqual({
      personId: person.personId,
      email: null,
      phone: null,
    });
  });

  it('answers 404 for an unknown person and 400 for an id that is not a UUID', async () => {
    const unknown = await api.get(
      `/internal/v1/persons/${randomUUID()}/contacts`,
      NOTIFICATIONS,
      ACTING_PSC,
    );
    const invalid = await api.get(
      '/internal/v1/persons/not-a-uuid/contacts',
      NOTIFICATIONS,
      ACTING_PSC,
    );

    expect(unknown.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
  });

  it('refuses user tokens, whatever their roles', async () => {
    const person = await givenPerson({ email: 'mary@example.go.ke', phone: null });

    const response = await api.get(
      `/internal/v1/persons/${person.personId}/contacts`,
      { sub: 'helpdesk-1', tenant: 'platform', roles: ['helpdesk', 'platform-admin'] },
      ACTING_PSC,
    );

    expect(response.statusCode).toBe(403);
  });

  it('refuses service tokens with directory:internal only: contacts need their own scope', async () => {
    const person = await givenPerson({ email: 'mary@example.go.ke', phone: null });

    const response = await api.get(
      `/internal/v1/persons/${person.personId}/contacts`,
      DECLARATIONS,
      ACTING_PSC,
    );

    expect(response.statusCode).toBe(403);
  });

  it('answers 404 for a person not onboarded at the acting tenant, and 400 without one', async () => {
    const person = await givenPerson({ email: 'mary@example.go.ke', phone: null });
    const url = `/internal/v1/persons/${person.personId}/contacts`;

    expect((await api.get(url, NOTIFICATIONS, { 'x-acting-tenant': 'tsc' })).statusCode).toBe(404);
    expect((await api.get(url, NOTIFICATIONS)).statusCode).toBe(400);
  });
});

describe('S18 internal access', () => {
  it('refuses user tokens with 403, even with X-Acting-Tenant', async () => {
    const response = await api.get(
      '/internal/v1/commissions/psc/policy',
      { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] },
      ACTING_PSC,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json<Problem>().detail).toBe(
      'Requires a service token with scope directory:internal.',
    );
  });

  it('refuses service tokens of other internal APIs', async () => {
    const response = await api.get(
      '/internal/v1/commissions/psc/policy',
      { sub: 'service-account-directory', azp: 'directory', scope: 'documents:internal' },
      ACTING_PSC,
    );

    expect(response.statusCode).toBe(403);
  });

  it('answers 400 without X-Acting-Tenant', async () => {
    const response = await api.get('/internal/v1/commissions/psc/policy', DECLARATIONS);

    expect(response.statusCode).toBe(400);
  });
});

/** A completed import of `slug`'s roster, as `givenRoster` arranges it. */
async function givenRosterImportOf(slug: string): Promise<{ importId: string }> {
  await givenRoster(api, slug, [
    {
      personnelFileNumber: `${slug.toUpperCase()}/1`,
      fullName: 'Otieno Ouma',
      nationalId: '56789012',
    },
  ]);
  const response = await api.get(`/v1/commissions/${slug}/roster/imports`, {
    sub: `officer-${slug}`,
    tenant: slug,
    roles: ['reporting-officer'],
  });
  expect(response.statusCode, response.body).toBe(200);
  const [latest] = response.json<{ items: RosterImport[] }>().items;
  if (!latest) throw new Error(`no import of ${slug}`);
  return { importId: latest.id };
}
