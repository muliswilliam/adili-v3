import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cycleCalendar } from '../../src/db/schema.js';

import { CommissionRefs } from '../../src/obligations/commission-refs.js';
import {
  COMMISSION_CREATED,
  DECLARANT_ONBOARDED,
  ROSTER_IMPORT_COMPLETED,
} from '../../src/obligations/events.js';
import type { NationalSummary } from '../../src/obligations/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 04 S16 (national part) over HTTP: EACC and platform admins read per-Commission counts of a
 * cycle, the officers due or overdue who have not onboarded and each Commission's last roster
 * import, with totals. No officer data. Everyone else gets 403.
 *
 * Today is 2027-10-15: the 2027 cycle is open, its biennials upcoming.
 */

const TODAY = '2027-10-15';
const NATIONAL = '/v1/obligations/summary';
const EACC: Caller = { tenant: 'eacc', roles: ['eacc-analyst'] };

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

const PSC_OVERDUE = rosterRecord('psc', { appointmentDate: '2027-08-01' });
const TSC_ONBOARDING = rosterRecord('tsc', { appointmentDate: '2027-10-01' });

/**
 * PSC: an officer appointed 2027-08-01, not onboarded (overdue initial, biennial) and a
 * long-serving onboarded one (biennial); imported twice, the later on 2027-10-01. TSC: an officer
 * appointed 2027-10-01, not onboarded (due initial, biennial), imported 2027-10-10. KRA: an
 * empty roster, imported 2027-09-01.
 */
beforeEach(async () => {
  await api.reset();
  api.clock.setToday(TODAY);
  api.directory.givenCommission('psc', 'Public Service Commission');
  api.directory.givenCommission('tsc', 'Teachers Service Commission');
  api.directory.givenCommission('kra', 'Kenya Revenue Authority');
  const pscOnboarded = rosterRecord('psc', { personId: randomUUID(), ofr: 'OFR-0000417-4' });
  await importRoster('psc', [PSC_OVERDUE], '2027-09-20T07:00:00.000Z');
  await importRoster('psc', [PSC_OVERDUE, pscOnboarded], '2027-10-01T07:00:00.000Z');
  await importRoster('tsc', [TSC_ONBOARDING], '2027-10-10T09:30:00.000Z');
  await importRoster('kra', [], '2027-09-01T06:00:00.000Z');
});

async function importRoster(
  tenant: string,
  records: ReturnType<typeof rosterRecord>[],
  time: string,
) {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted({
    ...directoryEvent(ROSTER_IMPORT_COMPLETED, tenant, { importId, channel: 'file' }),
    time,
  });
}

async function national(caller: Caller, query = ''): Promise<NationalSummary> {
  const response = await api.get(`${NATIONAL}${query ? `?${query}` : ''}`, caller);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<NationalSummary>();
  expect(contractErrors(okResponse(NATIONAL, 'get'), body)).toEqual([]);
  return body;
}

/** A biennial cycle under the statutory dates, opening 120 days before its statement date. */
const cycle = (year: number, opened: boolean) => ({
  key: `biennial:${String(year)}`,
  statementDate: `${String(year)}-11-01`,
  dueDate: `${String(year)}-12-31`,
  opensOn: `${String(year)}-07-04`,
  opened,
});

const counts = (upcoming: number, due: number, overdue: number, filed = 0) => ({
  upcoming,
  due,
  overdue,
  filed,
});

describe('GET /v1/obligations/summary', () => {
  it('counts the current cycle per Commission by name, with the last roster import and totals', async () => {
    expect(await national(EACC)).toEqual({
      cycle: cycle(2027, true),
      commissions: [
        {
          commission: { slug: 'kra', issuerCode: 'KRA', name: 'Kenya Revenue Authority' },
          total: counts(0, 0, 0),
          notOnboarded: 0,
          lastRosterImportAt: '2027-09-01T06:00:00.000Z',
        },
        {
          commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
          total: counts(2, 0, 1),
          notOnboarded: 1,
          lastRosterImportAt: '2027-10-01T07:00:00.000Z',
        },
        {
          commission: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
          total: counts(1, 1, 0),
          notOnboarded: 1,
          lastRosterImportAt: '2027-10-10T09:30:00.000Z',
        },
      ],
      totals: counts(3, 1, 1),
    });
  });

  it('keeps the latest import when an older one is handled last', async () => {
    await importRoster('tsc', [TSC_ONBOARDING], '2027-10-05T09:30:00.000Z');

    const tsc = (await national(EACC)).commissions.find((c) => c.commission.slug === 'tsc');

    expect(tsc?.lastRosterImportAt).toBe('2027-10-10T09:30:00.000Z');
  });

  it('does not take other roster events for an import', async () => {
    api.directory.givenRecords([
      {
        ...PSC_OVERDUE,
        personId: randomUUID(),
        state: 'onboarded',
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ]);
    await api.consumers.declarantOnboarded({
      ...directoryEvent(DECLARANT_ONBOARDED, 'psc', { rosterRecordId: PSC_OVERDUE.id }),
      time: '2027-10-14T10:00:00.000Z',
    });

    const psc = (await national(EACC)).commissions.find((c) => c.commission.slug === 'psc');

    expect(psc).toMatchObject({
      notOnboarded: 0,
      lastRosterImportAt: '2027-10-01T07:00:00.000Z',
    });
  });

  it("counts another cycle's biennials, and open initial and final obligations", async () => {
    const body = await national(EACC, 'cycle=biennial:2029');

    expect(body.cycle).toEqual(cycle(2029, false));
    expect(body.commissions.map((c) => [c.commission.slug, c.total, c.notOnboarded])).toEqual([
      ['kra', counts(0, 0, 0), 0],
      ['psc', counts(0, 0, 1), 1],
      ['tsc', counts(0, 1, 0), 1],
    ]);
    expect(body.totals).toEqual(counts(0, 1, 1));
  });

  it('answers 400 to a cycle that is not a biennial cycle key', async () => {
    const response = await api.get(`${NATIONAL}?cycle=2027`, EACC);

    expect(response.statusCode).toBe(400);
  });

  it('gives an empty list and zero totals before any roster import', async () => {
    await api.reset();
    api.clock.setToday('2027-06-01');

    expect(await national(EACC)).toEqual({
      cycle: cycle(2027, false),
      commissions: [],
      totals: counts(0, 0, 0),
    });
  });

  it('lists a Commission created without a roster yet, with zero counts', async () => {
    api.directory.givenCommission('nlc', 'National Land Commission');

    await api.consumers.commissionCreated(
      directoryEvent(COMMISSION_CREATED, 'nlc', {
        commissionId: randomUUID(),
        slug: 'nlc',
        type: 'commission',
      }),
    );

    const body = await national(EACC);
    expect(body.commissions.map((c) => c.commission.slug)).toEqual(['kra', 'nlc', 'psc', 'tsc']);
    expect(body.commissions.find((c) => c.commission.slug === 'nlc')).toEqual({
      commission: { slug: 'nlc', issuerCode: 'NLC', name: 'National Land Commission' },
      total: counts(0, 0, 0),
      notOnboarded: 0,
      lastRosterImportAt: null,
    });
    expect(body.totals).toEqual(counts(3, 1, 1));
  });

  it('lists every Commission the directory has once it pulls them all (start-up)', async () => {
    await api.reset();
    api.clock.setToday('2027-06-01');
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.givenCommission('nlc', 'National Land Commission');

    await api.app.get(CommissionRefs).pullAll();

    const body = await national(EACC);
    expect(body.commissions.map((c) => [c.commission.name, c.lastRosterImportAt])).toEqual([
      ['National Land Commission', null],
      ['Public Service Commission', null],
    ]);
  });

  it('keeps the last roster import when the Commission is pulled again', async () => {
    await api.app.get(CommissionRefs).pullAll();

    const psc = (await national(EACC)).commissions.find((c) => c.commission.slug === 'psc');
    expect(psc?.lastRosterImportAt).toBe('2027-10-01T07:00:00.000Z');
  });

  it('names the opening day of a cycle not open yet', async () => {
    api.clock.setToday('2027-06-01');

    expect((await national(EACC)).cycle).toEqual(cycle(2027, false));
  });

  it('opens a cycle early when the calendar brings its opening day forward', async () => {
    await api.db
      .update(cycleCalendar)
      .set({ openingLeadDays: 762 })
      .where(eq(cycleCalendar.cycleYear, 2029));

    expect((await national(EACC)).cycle).toEqual({ ...cycle(2029, true), opensOn: '2027-10-01' });
  });
});

describe('S16 visibility of the national summary', () => {
  it.each([
    { tenant: 'eacc', roles: ['eacc-supervisor'] },
    { tenant: 'platform', roles: ['platform-admin'] },
  ])('lets $roles.0 read it', async (caller) => {
    expect((await national(caller)).commissions).toHaveLength(3);
  });

  it.each([
    { tenant: 'psc', roles: ['reporting-officer'] },
    { tenant: 'psc', roles: ['commission-admin'] },
    { tenant: 'psc', roles: ['supervisor'] },
    { roles: ['declarant'], personId: randomUUID() },
  ])('answers 403 to $roles.0', async (caller) => {
    expect((await api.get(NATIONAL, caller)).statusCode).toBe(403);
  });

  it('answers 401 without a token', async () => {
    expect((await api.anonymous(NATIONAL)).statusCode).toBe(401);
  });
});
