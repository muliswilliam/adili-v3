import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { filingObligations, obligationDrafts, rosterSnapshots } from '../../src/db/schema.js';
import type { Declaration } from '../../src/drafts/representation.js';
import { ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import type { DeclarationProgress } from '../../src/obligations/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * #300 over HTTP: a Commission's declarants counted per reporting entity for a cycle, as not
 * started, in progress (a live draft), submitted (filed) and late (overdue), with no declarant
 * data. Obligations come from roster imports through the inbox, drafts are started and discarded
 * through the drafts API, as in production.
 *
 * Today is 2027-11-15: the 2027 cycle is open (statement 1 November, due 31 December), so its
 * biennials are due.
 */

const TODAY = '2027-11-15';
const PROGRESS = '/v1/commissions/{slug}/declarations/progress';

const HEALTH = { id: '0192f1a0-5a11-7000-8000-00000000e001', name: 'Ministry of Health' };
const EDUCATION = { id: '0192f1a0-5a11-7000-8000-00000000e002', name: 'Ministry of Education' };

const PSC_OFFICER: Caller = { tenant: 'psc', roles: ['reporting-officer'] };
const PSC_ADMIN: Caller = { tenant: 'psc', roles: ['commission-admin'] };

const people = {
  akinyi: randomUUID(),
  baraka: randomUUID(),
  chebet: randomUUID(),
  daudi: randomUUID(),
  faith: randomUUID(),
  tsc: randomUUID(),
};
const declarant = (personId: string): Caller => ({ personId, roles: ['declarant'] });

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

/**
 * PSC's roster, all long-serving unless said:
 * - Ministry of Health: Akinyi (onboarded, no draft), Baraka (onboarded, draft started), Chebet
 *   (onboarded, draft started then discarded).
 * - Ministry of Education: Daudi (onboarded, biennial filed), Esther (not onboarded, appointed
 *   2027-08-01: initial overdue and a biennial), Faith (onboarded, appointed 2027-08-01: initial
 *   overdue with a draft started, and a biennial).
 * - No reporting entity: Gitau (not onboarded).
 *
 * TSC has one onboarded declarant of the Ministry of Education with a draft, who must never show
 * at PSC.
 */
beforeEach(async () => {
  await api.reset();
  api.clock.setToday(TODAY);
  api.directory.givenCommission('psc', 'Public Service Commission');
  api.directory.givenCommission('tsc', 'Teachers Service Commission');
  await importRoster('psc', [
    record('psc', 'Akinyi Wambui', HEALTH, { personId: people.akinyi }),
    record('psc', 'Baraka Mwangi', HEALTH, { personId: people.baraka }),
    record('psc', 'Chebet Kiprono', HEALTH, { personId: people.chebet }),
    record('psc', 'Daudi Ochieng', EDUCATION, { personId: people.daudi }),
    record('psc', 'Esther Njeri', EDUCATION, { appointmentDate: '2027-08-01' }),
    record('psc', 'Faith Achieng', EDUCATION, {
      personId: people.faith,
      appointmentDate: '2027-08-01',
    }),
    record('psc', 'Gitau Kamau', null),
  ]);
  await importRoster('tsc', [record('tsc', 'Hawa Tsc', EDUCATION, { personId: people.tsc })]);

  await startDraft('psc', 'Baraka Mwangi', 'biennial', people.baraka);
  const discarded = await startDraft('psc', 'Chebet Kiprono', 'biennial', people.chebet);
  const response = await api.request(
    'DELETE',
    `/v1/declarations/${discarded.id}`,
    declarant(people.chebet),
  );
  expect(response.statusCode, response.body).toBe(204);
  await startDraft('psc', 'Faith Achieng', 'initial', people.faith);
  await startDraft('tsc', 'Hawa Tsc', 'biennial', people.tsc);
  await updateObligation('psc', 'Daudi Ochieng', 'biennial', { status: 'filed' });
});

function record(
  tenant: string,
  fullName: string,
  reportingEntity: { id: string; name: string } | null,
  options: { personId?: string; appointmentDate?: string } = {},
) {
  return rosterRecord(tenant, {
    fullName,
    reportingEntity,
    appointmentDate: options.appointmentDate ?? '2010-02-01',
    ...(options.personId ? { personId: options.personId, ofr: 'OFR-0000417-4' } : {}),
  });
}

async function importRoster(tenant: string, records: ReturnType<typeof rosterRecord>[]) {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, tenant, { importId, channel: 'file' }),
  );
}

/** Obligation id of a declarant's obligation of `type`. */
async function obligationIdOf(tenant: string, fullName: string, type: 'initial' | 'biennial') {
  return withTenant(api.db, { tenant, subject: 'test' }, async (tx) => {
    const [row] = await tx
      .select({ id: filingObligations.id })
      .from(filingObligations)
      .innerJoin(
        rosterSnapshots,
        eq(rosterSnapshots.rosterRecordId, filingObligations.rosterRecordId),
      )
      .where(and(eq(rosterSnapshots.fullName, fullName), eq(filingObligations.type, type)));
    if (!row) throw new Error(`no ${type} obligation for ${fullName}`);
    return row.id;
  });
}

async function startDraft(
  tenant: string,
  fullName: string,
  type: 'initial' | 'biennial',
  personId: string,
): Promise<Declaration> {
  const obligationId = await obligationIdOf(tenant, fullName, type);
  const response = await api.request(
    'POST',
    `/v1/obligations/${obligationId}/declaration`,
    declarant(personId),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Declaration>();
}

/** Updates an obligation behind the API, as filing (slice 06) will. */
async function updateObligation(
  tenant: string,
  fullName: string,
  type: 'initial' | 'biennial',
  set: Partial<typeof filingObligations.$inferInsert>,
) {
  const id = await obligationIdOf(tenant, fullName, type);
  await withTenant(api.db, { tenant, subject: 'test' }, (tx) =>
    tx.update(filingObligations).set(set).where(eq(filingObligations.id, id)),
  );
}

const path = (slug: string, query = '') =>
  `${PROGRESS.replace('{slug}', slug)}${query ? `?${query}` : ''}`;

async function progress(caller: Caller, slug = 'psc', query = ''): Promise<DeclarationProgress> {
  const response = await api.get(path(slug, query), caller);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<DeclarationProgress>();
  expect(contractErrors(okResponse(PROGRESS, 'get'), body)).toEqual([]);
  return body;
}

const counts = (notStarted: number, inProgress: number, submitted: number, late: number) => ({
  notStarted,
  inProgress,
  submitted,
  late,
});

/** A biennial cycle under the statutory dates, opening 120 days before its statement date. */
const cycle = (year: number, opened: boolean) => ({
  key: `biennial:${String(year)}`,
  statementDate: `${String(year)}-11-01`,
  dueDate: `${String(year)}-12-31`,
  opensOn: `${String(year)}-07-04`,
  opened,
});

describe('#300 GET /v1/commissions/{slug}/declarations/progress', () => {
  it('counts not started, in progress, submitted and late per reporting entity for the current cycle', async () => {
    expect(await progress(PSC_OFFICER)).toEqual({
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      cycle: cycle(2027, true),
      cycles: [cycle(2027, true), cycle(2029, false), cycle(2031, false)],
      reportingEntities: [
        {
          // Esther's and Faith's initials are late, Faith's despite her draft; Daudi's biennial is
          // filed; Esther's and Faith's biennials have no draft.
          reportingEntity: EDUCATION,
          counts: counts(2, 0, 1, 2),
        },
        {
          // Akinyi has no draft, Chebet discarded hers: both not started; Baraka's is in progress.
          reportingEntity: HEALTH,
          counts: counts(2, 1, 0, 0),
        },
        { reportingEntity: null, counts: counts(1, 0, 0, 0) },
      ],
      total: counts(5, 1, 1, 2),
    });
  });

  it('gives the commission-admin the same counts', async () => {
    expect(await progress(PSC_ADMIN)).toEqual(await progress(PSC_OFFICER));
  });

  it('follows drafts as they are started and discarded', async () => {
    const draft = await startDraft('psc', 'Akinyi Wambui', 'biennial', people.akinyi);
    const health = async () =>
      (await progress(PSC_OFFICER)).reportingEntities.find(
        (entry) => entry.reportingEntity?.id === HEALTH.id,
      )?.counts;
    expect(await health()).toEqual(counts(1, 2, 0, 0));

    const response = await api.request(
      'DELETE',
      `/v1/declarations/${draft.id}`,
      declarant(people.akinyi),
    );
    expect(response.statusCode, response.body).toBe(204);
    expect(await health()).toEqual(counts(2, 1, 0, 0));
  });

  it('counts a submitted obligation once it is filed, whatever its draft', async () => {
    await updateObligation('psc', 'Baraka Mwangi', 'biennial', { status: 'filed' });
    const { total } = await progress(PSC_OFFICER);
    expect(total).toEqual(counts(5, 0, 2, 2));
  });

  it('counts the cycle asked for', async () => {
    const body = await progress(PSC_OFFICER, 'psc', 'cycle=biennial:2029');
    expect(body.cycle.key).toBe('biennial:2029');
    // Only the open initials count in a later cycle; the 2027 biennials do not.
    expect(body.reportingEntities).toEqual([
      { reportingEntity: EDUCATION, counts: counts(0, 0, 0, 2) },
    ]);
  });

  it('keeps the draft marker to identifiers, readable by the Commission only', async () => {
    const psc = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select().from(obligationDrafts),
    );
    expect(psc).toHaveLength(2);
    for (const row of psc) {
      expect(Object.keys(row).sort()).toEqual([
        'declarationId',
        'obligationId',
        'personId',
        'startedAt',
        'tenant',
      ]);
      expect(row.tenant).toBe('psc');
    }
  });

  it.each([
    ['a reviewer', { tenant: 'psc', roles: ['reviewer'] }],
    ['a supervisor', { tenant: 'psc', roles: ['supervisor'] }],
    ['a platform admin', { tenant: 'platform', roles: ['platform-admin'] }],
    ['an EACC analyst', { tenant: 'platform', roles: ['eacc-analyst'] }],
    ['a declarant', { personId: people.akinyi, roles: ['declarant'] }],
    ["another Commission's reporting officer", { tenant: 'tsc', roles: ['reporting-officer'] }],
    ["another Commission's commission-admin", { tenant: 'tsc', roles: ['commission-admin'] }],
  ] satisfies [string, Caller][])('answers 404 to %s', async (_, caller) => {
    const response = await api.get(path('psc'), caller);
    expect(response.statusCode, response.body).toBe(404);
  });

  it('answers 404 to a reporting officer asking for every Commission as `platform`', async () => {
    const caller: Caller = { tenant: 'platform', roles: ['reporting-officer'] };
    const response = await api.get(path('platform'), caller);
    expect(response.statusCode, response.body).toBe(404);
  });

  it('answers 400 to a cycle that is not a biennial key', async () => {
    const response = await api.get(path('psc', 'cycle=2027'), PSC_OFFICER);
    expect(response.statusCode, response.body).toBe(400);
  });
});
