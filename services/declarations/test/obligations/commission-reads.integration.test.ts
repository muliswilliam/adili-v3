import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  cycleCalendar,
  cycleOpenings,
  filingObligations,
  obligationReminders,
  rosterSnapshots,
} from '../../src/db/schema.js';
import { ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import type {
  CommissionSummary,
  ObligationListItem,
  ObligationPage,
} from '../../src/obligations/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 04 S15 and S16 over HTTP: a Commission's obligations summary (counts by type and status,
 * and declarants due or overdue who have not onboarded) and its declarant list (filters, search,
 * cursor pages), with the authorisation matrix. Obligations come from roster imports through the
 * inbox, as in production.
 *
 * Today is 2027-10-15: the 2027 cycle is open (statement 1 November, due 31 December), so its
 * biennials are upcoming; PSC's obligations start on 2027-01-01.
 */

const TODAY = '2027-10-15';
const SUMMARY = '/v1/commissions/{slug}/obligations/summary';
const LIST = '/v1/commissions/{slug}/obligations';

const PSC_OFFICER: Caller = { tenant: 'psc', roles: ['reporting-officer'] };

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

/**
 * PSC's roster:
 * - Akinyi Wambui, appointed 2027-10-01, onboarded: initial due 2027-10-31, biennial upcoming.
 * - Baraka Mwangi, appointed 2027-08-01, not onboarded: initial overdue (2027-08-31), biennial.
 * - Chebet Kiprono, long-serving, not onboarded: biennial.
 * - Daudi Ochieng, long-serving, onboarded: biennial.
 * - Esther Njeri, long-serving, exited 2027-10-01, not onboarded: final due 2027-10-31 (no
 *   biennial: she left before its statement date).
 * - Faith Achieng, appointed 2027-03-01, onboarded: initial overdue (2027-03-31), biennial.
 *
 * TSC has one long-serving declarant (a biennial), who must never show at PSC.
 */
beforeEach(async () => {
  await api.reset();
  api.clock.setToday(TODAY);
  api.directory.givenCommission('psc', 'Public Service Commission');
  api.directory.givenCommission('tsc', 'Teachers Service Commission');
  await importRoster('psc', [
    declarant('PSC/1001', 'Akinyi Wambui', { appointmentDate: '2027-10-01', onboarded: true }),
    declarant('PSC/1002', 'Baraka Mwangi', { appointmentDate: '2027-08-01' }),
    declarant('PSC/2001', 'Chebet Kiprono', { appointmentDate: '2010-02-01' }),
    declarant('PSC/2002', 'Daudi Ochieng', { appointmentDate: '2011-05-01', onboarded: true }),
    declarant('PSC/2003', 'Esther Njeri', {
      appointmentDate: '2012-01-09',
      exitDate: '2027-10-01',
    }),
    declarant('PSC/1003', 'Faith Achieng', { appointmentDate: '2027-03-01', onboarded: true }),
  ]);
  await importRoster('tsc', [
    rosterRecord('tsc', { personnelFileNumber: 'PSC/9999', fullName: 'Akinyi Tsc' }),
  ]);
});

function declarant(
  personnelFileNumber: string,
  fullName: string,
  options: { appointmentDate: string; exitDate?: string; onboarded?: boolean },
) {
  return rosterRecord('psc', {
    personnelFileNumber,
    fullName,
    appointmentDate: options.appointmentDate,
    exitDate: options.exitDate ?? null,
    ...(options.exitDate ? { state: 'exited' as const } : {}),
    ...(options.onboarded ? { personId: randomUUID(), ofr: 'OFR-0000417-4' } : {}),
  });
}

async function importRoster(tenant: string, records: ReturnType<typeof rosterRecord>[]) {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, tenant, { importId, channel: 'file' }),
  );
}

const path = (template: string, slug: string, query = '') =>
  `${template.replace('{slug}', slug)}${query ? `?${query}` : ''}`;

async function summary(caller: Caller, slug = 'psc', query = ''): Promise<CommissionSummary> {
  const response = await api.get(path(SUMMARY, slug, query), caller);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<CommissionSummary>();
  expect(contractErrors(okResponse(SUMMARY, 'get'), body)).toEqual([]);
  return body;
}

async function page(caller: Caller, query = '', slug = 'psc'): Promise<ObligationPage> {
  const response = await api.get(path(LIST, slug, query), caller);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<ObligationPage>();
  expect(contractErrors(okResponse(LIST, 'get'), body)).toEqual([]);
  return body;
}

const rows = (items: ObligationListItem[]) =>
  items.map((item) => `${item.declarant.fullName} ${item.type} ${item.status} ${item.dueDate}`);

/** Updates PSC obligations behind the API, e.g. to file or cancel one. */
async function updateObligation(
  fullName: string,
  type: 'initial' | 'biennial' | 'final',
  set: Partial<typeof filingObligations.$inferInsert>,
) {
  await withTenant(api.db, { tenant: 'psc', subject: 'test' }, async (tx) => {
    const [row] = await tx
      .select({ id: filingObligations.id })
      .from(filingObligations)
      .innerJoin(
        rosterSnapshots,
        eq(rosterSnapshots.rosterRecordId, filingObligations.rosterRecordId),
      )
      .where(and(eq(rosterSnapshots.fullName, fullName), eq(filingObligations.type, type)));
    if (!row) throw new Error(`no ${type} obligation for ${fullName}`);
    await tx.update(filingObligations).set(set).where(eq(filingObligations.id, row.id));
  });
}

const counts = (upcoming: number, due: number, overdue: number, filed = 0) => ({
  upcoming,
  due,
  overdue,
  filed,
});

/** A biennial cycle under the statutory dates, opening 120 days before its statement date. */
const cycle = (year: number, opened: boolean) => ({
  key: `biennial:${String(year)}`,
  statementDate: `${String(year)}-11-01`,
  dueDate: `${String(year)}-12-31`,
  opensOn: `${String(year)}-07-04`,
  opened,
});

/** Obligation id of a PSC declarant's obligation of `type`. */
async function obligationIdOf(fullName: string, type: 'initial' | 'biennial' | 'final') {
  return withTenant(api.db, { tenant: 'psc', subject: 'test' }, async (tx) => {
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

describe('S15 GET /v1/commissions/{slug}/obligations/summary', () => {
  it('counts the current cycle by type and status, and not-onboarded declarants due or overdue', async () => {
    expect(await summary(PSC_OFFICER)).toEqual({
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      cycle: cycle(2027, true),
      cycles: [cycle(2027, true), cycle(2029, false), cycle(2031, false)],
      total: counts(5, 2, 2),
      byType: {
        initial: counts(0, 1, 2),
        biennial: counts(5, 0, 0),
        final: counts(0, 1, 0),
      },
      // Baraka (overdue initial) and Esther (due final); Chebet's biennial is only upcoming.
      notOnboarded: { due: 1, overdue: 1 },
    });
  });

  it('counts an declarant once, under overdue, when they have both a due and an overdue obligation', async () => {
    api.clock.setToday('2027-11-05');
    await updateObligation('Baraka Mwangi', 'biennial', { status: 'due' });

    expect((await summary(PSC_OFFICER)).notOnboarded).toEqual({ due: 1, overdue: 1 });
  });

  it('leaves cancelled obligations out', async () => {
    await updateObligation('Chebet Kiprono', 'biennial', {
      status: 'cancelled',
      cancelReason: 'superseded',
    });

    expect((await summary(PSC_OFFICER)).byType.biennial).toEqual(counts(4, 0, 0));
  });

  it("counts another cycle's biennials, open initials and finals, and those filed in its two years", async () => {
    await updateObligation('Faith Achieng', 'initial', { status: 'filed' });

    const current = await summary(PSC_OFFICER);
    const next = await summary(PSC_OFFICER, 'psc', 'cycle=biennial:2029');

    expect(current.byType.initial).toEqual(counts(0, 1, 1, 1));
    expect(next.cycle).toEqual(cycle(2029, false));
    // Faith's initial was filed in 2027, outside 2028-2029.
    expect(next.byType).toEqual({
      initial: counts(0, 1, 1),
      biennial: counts(0, 0, 0),
      final: counts(0, 1, 0),
    });
  });

  it('keeps the latest opened cycle current until the next one opens', async () => {
    api.clock.setToday('2028-06-30');

    expect((await summary(PSC_OFFICER)).cycle.key).toBe('biennial:2027');
  });

  it('opens a cycle early when the calendar brings its opening day forward', async () => {
    // The demo seed does this: 2029 opens on 2027-10-01 instead of 2029-07-04.
    await api.db
      .update(cycleCalendar)
      .set({ openingLeadDays: 762 })
      .where(eq(cycleCalendar.cycleYear, 2029));

    const body = await summary(PSC_OFFICER);

    expect(body.cycle).toEqual({ ...cycle(2029, true), opensOn: '2027-10-01' });
    expect(body.cycles.map((entry) => [entry.key, entry.opened])).toEqual([
      ['biennial:2027', true],
      ['biennial:2029', true],
      ['biennial:2031', false],
    ]);
  });

  it('counts a cycle as opened once its biennials were created, even before its opening day', async () => {
    api.clock.setToday('2027-06-01');
    await api.db
      .insert(cycleOpenings)
      .values({ tenant: 'psc', cycleYear: 2027, obligationsCreated: 5 });

    expect((await summary(PSC_OFFICER)).cycle).toEqual(cycle(2027, true));
    expect((await summary({ tenant: 'tsc', roles: ['supervisor'] }, 'tsc')).cycle).toEqual(
      cycle(2027, false),
    );
  });

  it('gives a Commission without obligations zero counts and the next cycle', async () => {
    api.clock.setToday('2026-09-28');

    expect(await summary({ tenant: 'kra', roles: ['supervisor'] }, 'kra')).toEqual({
      commission: { slug: 'kra', issuerCode: 'KRA', name: 'KRA' },
      cycle: cycle(2027, false),
      cycles: [cycle(2027, false), cycle(2029, false), cycle(2031, false)],
      total: counts(0, 0, 0),
      byType: { initial: counts(0, 0, 0), biennial: counts(0, 0, 0), final: counts(0, 0, 0) },
      notOnboarded: { due: 0, overdue: 0 },
    });
  });

  it('answers 400 to a cycle that is not a biennial cycle key', async () => {
    const response = await api.get(path(SUMMARY, 'psc', 'cycle=initial:2027-01-01'), PSC_OFFICER);

    expect(response.statusCode).toBe(400);
  });
});

describe('S15 GET /v1/commissions/{slug}/obligations', () => {
  it('lists the Commission’s obligations overdue first, then by due date, with the declarant', async () => {
    const body = await page(PSC_OFFICER);

    expect(rows(body.items).slice(0, 4)).toEqual([
      'Faith Achieng initial overdue 2027-03-31',
      'Baraka Mwangi initial overdue 2027-08-31',
      expect.stringMatching(/^(Akinyi Wambui initial|Esther Njeri final) due 2027-10-31$/),
      expect.stringMatching(/^(Akinyi Wambui initial|Esther Njeri final) due 2027-10-31$/),
    ]);
    expect(rows(body.items).slice(4).sort()).toEqual([
      'Akinyi Wambui biennial upcoming 2027-12-31',
      'Baraka Mwangi biennial upcoming 2027-12-31',
      'Chebet Kiprono biennial upcoming 2027-12-31',
      'Daudi Ochieng biennial upcoming 2027-12-31',
      'Faith Achieng biennial upcoming 2027-12-31',
    ]);
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]).toMatchObject({
      commission: { slug: 'psc', name: 'Public Service Commission' },
      cycleKey: 'initial:2027-03-01',
      statementDate: '2027-03-01',
      remindersSent: 0,
      // Its reminders were all past when it was created, on 2027-10-15.
      lastReminder: {
        offsetDays: 7,
        scheduledAt: '2027-03-23T21:00:00.000Z',
        sentAt: null,
        channels: [],
        outcome: 'skipped-past-due-at-creation',
      },
      declarant: {
        personnelFileNumber: 'PSC/1003',
        fullName: 'Faith Achieng',
        onboarded: true,
        ofr: 'OFR-0000417-4',
      },
    });
  });

  it("carries each obligation's latest reminder", async () => {
    const id = await obligationIdOf('Daudi Ochieng', 'biennial');
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.insert(obligationReminders).values([
        {
          obligationId: id,
          tenant: 'psc',
          offsetDays: 14,
          scheduledAt: new Date('2027-12-17T12:00:00+03:00'),
          outcome: 'skipped-no-contact',
        },
        {
          obligationId: id,
          tenant: 'psc',
          offsetDays: 30,
          scheduledAt: new Date('2027-12-01T12:00:00+03:00'),
          sentAt: new Date('2027-12-01T12:04:00+03:00'),
          channels: ['sms', 'email'],
          messageIds: [randomUUID(), randomUUID()],
          outcome: 'sent',
        },
      ]),
    );

    const item = (await page(PSC_OFFICER, 'search=Daudi&type=biennial')).items[0];

    expect(item).toMatchObject({
      remindersSent: 1,
      lastReminder: {
        offsetDays: 14,
        scheduledAt: '2027-12-17T09:00:00.000Z',
        sentAt: null,
        channels: [],
        outcome: 'skipped-no-contact',
      },
    });
  });

  it('filters by type, status, onboarded and cycle', async () => {
    const initial = await page(PSC_OFFICER, 'type=initial');
    const overdue = await page(PSC_OFFICER, 'status=overdue');
    const notOnboarded = await page(PSC_OFFICER, 'onboarded=false');
    const onboardedDue = await page(PSC_OFFICER, 'onboarded=true&status=due');
    const cycle = await page(PSC_OFFICER, 'cycle=biennial:2027');
    const otherCycle = await page(PSC_OFFICER, 'cycle=biennial:2029');

    expect(initial.items.map((item) => item.declarant.fullName)).toEqual([
      'Faith Achieng',
      'Baraka Mwangi',
      'Akinyi Wambui',
    ]);
    expect(overdue.items.map((item) => item.declarant.fullName)).toEqual([
      'Faith Achieng',
      'Baraka Mwangi',
    ]);
    expect(rows(notOnboarded.items).sort()).toEqual([
      'Baraka Mwangi biennial upcoming 2027-12-31',
      'Baraka Mwangi initial overdue 2027-08-31',
      'Chebet Kiprono biennial upcoming 2027-12-31',
      'Esther Njeri final due 2027-10-31',
    ]);
    expect(notOnboarded.items.every((item) => !item.declarant.onboarded)).toBe(true);
    expect(rows(onboardedDue.items)).toEqual(['Akinyi Wambui initial due 2027-10-31']);
    expect(cycle.items).toHaveLength(5);
    expect(cycle.items.every((item) => item.cycleKey === 'biennial:2027')).toBe(true);
    expect(otherCycle.items).toEqual([]);
  });

  it('leaves cancelled obligations out unless asked for', async () => {
    await updateObligation('Chebet Kiprono', 'biennial', {
      status: 'cancelled',
      cancelReason: 'superseded',
    });

    const all = await page(PSC_OFFICER);
    const cancelled = await page(PSC_OFFICER, 'status=cancelled');

    expect(all.items).toHaveLength(8);
    expect(rows(cancelled.items)).toEqual(['Chebet Kiprono biennial cancelled 2027-12-31']);
  });

  it('searches by file number prefix and name fragment, case-insensitively', async () => {
    const prefix = await page(PSC_OFFICER, 'search=psc/100');
    const fragment = await page(PSC_OFFICER, 'search=WAMB');
    const notAPrefix = await page(PSC_OFFICER, 'search=1001');
    const wildcard = await page(PSC_OFFICER, 'search=%25');

    expect(new Set(prefix.items.map((item) => item.declarant.fullName))).toEqual(
      new Set(['Akinyi Wambui', 'Baraka Mwangi', 'Faith Achieng']),
    );
    expect(rows(fragment.items)).toEqual([
      'Akinyi Wambui initial due 2027-10-31',
      'Akinyi Wambui biennial upcoming 2027-12-31',
    ]);
    expect(notAPrefix.items).toEqual([]);
    expect(wildcard.items).toEqual([]);
  });

  it('pages with a cursor, every obligation once, in order', async () => {
    const all = (await page(PSC_OFFICER)).items.map((item) => item.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = await page(PSC_OFFICER, query);
      expect(body.items.length).toBeLessThanOrEqual(3);
      seen.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(seen).toEqual(all);
  });

  it('answers 400 to an unknown cursor, a limit over 200 and an unknown filter value', async () => {
    const cursor = await api.get(path(LIST, 'psc', 'cursor=not-a-cursor'), PSC_OFFICER);
    const limit = await api.get(path(LIST, 'psc', 'limit=201'), PSC_OFFICER);
    const status = await api.get(path(LIST, 'psc', 'status=late'), PSC_OFFICER);

    expect(cursor.statusCode).toBe(400);
    expect(limit.statusCode).toBe(400);
    expect(status.statusCode).toBe(400);
  });
});

describe('S16 visibility of Commission obligations', () => {
  it.each(['reporting-officer', 'reviewer', 'supervisor', 'commission-admin'])(
    'shows a %s of PSC the summary and list of PSC only',
    async (role) => {
      const caller = { tenant: 'psc', roles: [role] };

      const body = await page(caller);

      expect((await summary(caller)).total.upcoming).toBe(5);
      expect(body.items).toHaveLength(9);
      expect(body.items.every((item) => item.commission.slug === 'psc')).toBe(true);
    },
  );

  it("answers 404 to TSC's staff for PSC's summary and list", async () => {
    const tscOfficer = { tenant: 'tsc', roles: ['reporting-officer'] };

    const summaryResponse = await api.get(path(SUMMARY, 'psc'), tscOfficer);
    const listResponse = await api.get(path(LIST, 'psc'), tscOfficer);

    expect(summaryResponse.statusCode).toBe(404);
    expect(listResponse.statusCode).toBe(404);
  });

  it.each(['eacc-analyst', 'eacc-supervisor'])(
    'gives an %s any Commission’s summary, never the list (403)',
    async (role) => {
      const caller = { tenant: 'eacc', roles: [role] };

      const listResponse = await api.get(path(LIST, 'psc'), caller);

      expect((await summary(caller, 'psc')).total.upcoming).toBe(5);
      expect((await summary(caller, 'tsc')).total.upcoming).toBe(1);
      expect(listResponse.statusCode).toBe(403);
    },
  );

  it('gives a platform admin any Commission’s summary and list', async () => {
    const caller = { tenant: 'platform', roles: ['platform-admin'] };

    const tsc = await page(caller, '', 'tsc');

    expect((await summary(caller, 'psc')).total.upcoming).toBe(5);
    expect(rows(tsc.items)).toEqual(['Akinyi Tsc biennial upcoming 2027-12-31']);
  });

  it('answers 403 to a declarant and 401 without a token', async () => {
    const declarant = { roles: ['declarant'], personId: randomUUID() };

    const summaryResponse = await api.get(path(SUMMARY, 'psc'), declarant);
    const listResponse = await api.get(path(LIST, 'psc'), declarant);

    expect(summaryResponse.statusCode).toBe(403);
    expect(listResponse.statusCode).toBe(403);
    expect((await api.anonymous(path(SUMMARY, 'psc'))).statusCode).toBe(401);
    expect((await api.anonymous(path(LIST, 'psc'))).statusCode).toBe(401);
  });
});
