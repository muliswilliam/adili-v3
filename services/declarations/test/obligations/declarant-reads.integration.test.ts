import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { filingObligations, obligationReminders, outbox } from '../../src/db/schema.js';
import { ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import type { MyObligations, ObligationDetail } from '../../src/obligations/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 04 S14 and S17 over HTTP: a declarant reads their obligations by the `person_id` claim,
 * across Commissions and never anyone else's; staff read their Commission's. Obligations come from
 * roster imports through the inbox, as in production.
 *
 * Today is 2027-07-10 (the 2027 cycle is open; obligations start 2027-01-01).
 */

const TODAY = '2027-07-10';
const WANJIRU = randomUUID();
const OTIENO = randomUUID();
const declarant = (personId: string): Caller => ({ personId, roles: ['declarant'] });

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

/**
 * Wanjiru moved from TSC to PSC: at PSC she was appointed 2027-06-20 (an initial due 2027-07-20
 * and the 2027 biennial), at TSC she was appointed 2027-05-01 and is still on its roster (an
 * overdue initial and the biennial). Otieno is at PSC, long-serving (the biennial only). A PSC
 * declarant has not onboarded.
 */
beforeEach(async () => {
  await api.reset();
  api.clock.setToday(TODAY);
  api.directory.givenCommission('psc', 'Public Service Commission');
  api.directory.givenCommission('tsc', 'Teachers Service Commission');
  await importRoster('psc', [
    rosterRecord('psc', { personId: WANJIRU, ofr: 'OFR-0482913-L', appointmentDate: '2027-06-20' }),
    rosterRecord('psc', { personId: OTIENO, ofr: 'OFR-0000417-4', appointmentDate: '2010-02-01' }),
    rosterRecord('psc', { appointmentDate: '2019-03-01' }),
  ]);
  await importRoster('tsc', [
    rosterRecord('tsc', { personId: WANJIRU, ofr: 'OFR-0482913-L', appointmentDate: '2027-05-01' }),
  ]);
});

async function importRoster(tenant: string, records: ReturnType<typeof rosterRecord>[]) {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, tenant, { importId, channel: 'file' }),
  );
}

async function myObligations(caller: Caller): Promise<MyObligations> {
  const response = await api.get('/v1/me/obligations', caller);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<MyObligations>();
  expect(contractErrors(okResponse('/v1/me/obligations', 'get'), body)).toEqual([]);
  return body;
}

async function obligationIdOf(tenant: string, personId: string, type: string): Promise<string> {
  const [row] = await withTenant(api.db, { tenant, subject: 'test' }, (tx) =>
    tx
      .select({ id: filingObligations.id })
      .from(filingObligations)
      .where(
        and(eq(filingObligations.personId, personId), eq(filingObligations.type, type as never)),
      ),
  );
  if (!row) throw new Error(`no ${type} obligation at ${tenant}`);
  return row.id;
}

describe('S14 GET /v1/me/obligations', () => {
  it('groups a person with records at two Commissions into two groups, overdue first', async () => {
    const body = await myObligations(declarant(WANJIRU));

    expect(
      body.groups.map((group) => ({
        commission: group.commission,
        obligations: group.obligations.map((o) => [o.type, o.cycleKey, o.status, o.dueDate]),
      })),
    ).toEqual([
      {
        commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
        obligations: [
          ['initial', 'initial:2027-06-20', 'due', '2027-07-20'],
          ['biennial', 'biennial:2027', 'upcoming', '2027-12-31'],
        ],
      },
      {
        commission: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
        obligations: [
          ['initial', 'initial:2027-05-01', 'overdue', '2027-05-31'],
          ['biennial', 'biennial:2027', 'upcoming', '2027-12-31'],
        ],
      },
    ]);
    expect(body.groups[0]?.obligations[0]).toMatchObject({
      statementDate: '2027-06-20',
      cancelReason: null,
      remindersSent: 0,
      policyVersion: 1,
    });
  });

  it("gives another person only their own obligations, never Wanjiru's", async () => {
    const body = await myObligations(declarant(OTIENO));

    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.obligations.map((o) => o.cycleKey)).toEqual(['biennial:2027']);
  });

  it('gives a person without obligations no groups', async () => {
    expect(await myObligations(declarant(randomUUID()))).toEqual({ groups: [] });
  });

  it('leaves cancelled obligations out and counts only sent reminders', async () => {
    const initial = await obligationIdOf('psc', WANJIRU, 'initial');
    const biennial = await obligationIdOf('psc', WANJIRU, 'biennial');
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, async (tx) => {
      await tx
        .update(filingObligations)
        .set({ status: 'cancelled', cancelReason: 'superseded' })
        .where(eq(filingObligations.id, initial));
      await tx.insert(obligationReminders).values([
        {
          obligationId: biennial,
          tenant: 'psc',
          offsetDays: 30,
          scheduledAt: new Date('2027-12-01T09:00:00+03:00'),
          sentAt: new Date('2027-12-01T09:12:00+03:00'),
          channels: ['sms', 'email'],
          messageIds: [randomUUID(), randomUUID()],
          outcome: 'sent',
        },
        {
          obligationId: biennial,
          tenant: 'psc',
          offsetDays: 14,
          scheduledAt: new Date('2027-12-17T09:00:00+03:00'),
          outcome: 'failed',
        },
      ]);
    });

    const psc = (await myObligations(declarant(WANJIRU))).groups[0];

    expect(psc?.obligations.map((o) => [o.cycleKey, o.remindersSent])).toEqual([
      ['biennial:2027', 1],
    ]);
  });

  it('answers 404 to a token without person_id, staff included', async () => {
    const staff = await api.get('/v1/me/obligations', {
      tenant: 'psc',
      roles: ['reporting-officer'],
    });
    const unlinked = await api.get('/v1/me/obligations', { roles: ['declarant'] });

    expect(staff.statusCode).toBe(404);
    expect(unlinked.statusCode).toBe(404);
  });

  it('answers 401 without a token', async () => {
    expect((await api.anonymous('/v1/me/obligations')).statusCode).toBe(401);
  });
});

describe('S17 GET /v1/obligations/{id}', () => {
  it('shows the owning person the obligation with its reminder history, without the declarant', async () => {
    const id = await obligationIdOf('tsc', WANJIRU, 'initial');

    const response = await api.get(`/v1/obligations/${id}`, declarant(WANJIRU));

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ObligationDetail>();
    expect(contractErrors(okResponse('/v1/obligations/{id}', 'get'), body)).toEqual([]);
    expect(body).toMatchObject({
      id,
      commission: { slug: 'tsc', name: 'Teachers Service Commission' },
      type: 'initial',
      status: 'overdue',
      declarant: null,
    });
    // Due 2027-05-31 and created 2027-07-10: every reminder was already past.
    expect(body.reminders).toEqual(
      [
        [30, '2027-05-01'],
        [14, '2027-05-17'],
        [7, '2027-05-24'],
      ].map(([offsetDays, date]) => ({
        offsetDays,
        scheduledAt: new Date(`${String(date)}T00:00:00+03:00`).toISOString(),
        sentAt: null,
        channels: [],
        outcome: 'skipped-past-due-at-creation',
      })),
    );
  });

  it("answers 404 to another person's declarant token", async () => {
    const id = await obligationIdOf('tsc', WANJIRU, 'initial');

    const response = await api.get(`/v1/obligations/${id}`, declarant(OTIENO));

    expect(response.statusCode).toBe(404);
  });

  it("shows the Commission's staff and platform admins the declarant; others get 404", async () => {
    const id = await obligationIdOf('psc', WANJIRU, 'initial');

    const reviewer = await api.get(`/v1/obligations/${id}`, { tenant: 'psc', roles: ['reviewer'] });
    const platform = await api.get(`/v1/obligations/${id}`, {
      tenant: 'platform',
      roles: ['platform-admin'],
    });
    const otherCommission = await api.get(`/v1/obligations/${id}`, {
      tenant: 'tsc',
      roles: ['reporting-officer'],
    });
    const eacc = await api.get(`/v1/obligations/${id}`, {
      tenant: 'eacc',
      roles: ['eacc-analyst'],
    });

    expect(reviewer.statusCode, reviewer.body).toBe(200);
    expect(reviewer.json<ObligationDetail>().declarant).toMatchObject({
      personnelFileNumber: expect.stringMatching(/^PSC\//) as string,
      fullName: 'Achieng Otieno',
      onboarded: true,
      ofr: 'OFR-0482913-L',
    });
    expect(platform.statusCode).toBe(200);
    expect(otherCommission.statusCode).toBe(404);
    expect(eacc.statusCode).toBe(404);
  });

  it('records each read of an obligation in the audit trail (ADR-008)', async () => {
    const id = await obligationIdOf('psc', WANJIRU, 'initial');

    expect(
      (await api.get(`/v1/obligations/${id}`, { tenant: 'psc', roles: ['reviewer'] })).statusCode,
    ).toBe(200);

    const audited = (
      await api.db.select().from(outbox).where(eq(outbox.eventType, 'audit.read.v1'))
    ).map((row) => row.envelope);
    expect(audited.at(-1)).toMatchObject({
      source: 'adili/declarations',
      tenant: 'psc',
      data: {
        action: 'obligation.viewed',
        resource: { type: 'filing-obligation', params: { id } },
        actor: { tenant: 'psc', roles: ['reviewer'] },
        outcome: 'success',
        request: { method: 'GET', route: '/v1/obligations/:id' },
      },
    });
  });

  it('answers 404 for an unknown id and for one that is not a UUID', async () => {
    const unknown = await api.get(`/v1/obligations/${randomUUID()}`, declarant(WANJIRU));
    const malformed = await api.get('/v1/obligations/not-a-uuid', declarant(WANJIRU));

    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
  });
});
