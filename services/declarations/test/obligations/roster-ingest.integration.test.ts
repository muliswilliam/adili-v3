import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  filingObligations,
  inbox,
  obligationReminders,
  outbox,
  rosterSnapshots,
  tenantPolicyCache,
} from '../../src/db/schema.js';
import type { Transaction } from '../../src/obligations/apply-page.js';
import { DECLARANT_ONBOARDED, ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import type { ObligationDetail } from '../../src/obligations/representation.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { policyVersion, rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 04 S7 and S9 at the inbox seam: the directory's roster events drive the service, which
 * pulls the records they refer to (fake directory, pages of 1,000) and keeps obligations per the
 * engine, against real Postgres under row-level security.
 *
 * Today is 2027-07-10: the 2027 cycle opened on 2027-07-04 (120 days before 1 November) and PSC's
 * obligations start on 2027-01-01.
 */

const TODAY = '2027-07-10';
const PSC_STAFF = { tenant: 'psc', roles: ['reporting-officer'] };

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.setToday(TODAY);
  api.directory.givenCommission('psc', 'Public Service Commission');
});

function importCompleted(importId: string, tenant = 'psc') {
  return directoryEvent(ROSTER_IMPORT_COMPLETED, tenant, {
    importId,
    channel: 'file',
    declaredComplete: false,
  });
}

/** Reads as the platform (every tenant), as a test looking behind the API. */
function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

async function tableCount(table: typeof filingObligations | typeof rosterSnapshots) {
  return asPlatform(async (tx) => {
    const [row] = await tx.select({ n: count() }).from(table);
    return row?.n ?? 0;
  });
}

async function eventCount(type: string) {
  const [row] = await api.db.select({ n: count() }).from(outbox).where(eq(outbox.eventType, type));
  return row?.n ?? 0;
}

/**
 * 2,500 records: every fifth appointed on 2027-06-20 (an initial due 2027-07-20, and the 2027
 * biennial), the rest long-serving (the biennial only).
 */
function rosterOf2500() {
  return Array.from({ length: 2500 }, (_, index) =>
    rosterRecord('psc', {
      personnelFileNumber: `PSC/${String(index).padStart(5, '0')}`,
      appointmentDate: index % 5 === 0 ? '2027-06-20' : '2012-10-01',
    }),
  );
}

describe('S7 roster.import.completed.v1', () => {
  it('pulls three pages and keeps 2,500 snapshots with obligations per the engine, one event each', async () => {
    const importId = randomUUID();
    const records = rosterOf2500();
    api.directory.givenImport(importId, records);

    await api.consumers.importCompleted(importCompleted(importId));

    expect(api.directory.pulls).toEqual([
      `psc ${importId} -`,
      `psc ${importId} 1000`,
      `psc ${importId} 2000`,
    ]);
    expect(await tableCount(rosterSnapshots)).toBe(2500);

    const byTypeAndStatus = await asPlatform((tx) =>
      tx
        .select({
          type: filingObligations.type,
          status: filingObligations.status,
          statementDate: filingObligations.statementDate,
          dueDate: filingObligations.dueDate,
          n: count(),
        })
        .from(filingObligations)
        .groupBy(
          filingObligations.type,
          filingObligations.status,
          filingObligations.statementDate,
          filingObligations.dueDate,
        )
        .orderBy(asc(filingObligations.type)),
    );
    expect(byTypeAndStatus).toEqual([
      {
        type: 'biennial',
        status: 'upcoming',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        n: 2500,
      },
      {
        type: 'initial',
        status: 'due',
        statementDate: '2027-06-20',
        dueDate: '2027-07-20',
        n: 500,
      },
    ]);
    expect(await eventCount('obligation.created.v1')).toBe(3000);
    expect(api.workflows.created()).toHaveLength(3000);

    const [created] = await api.db
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, 'obligation.created.v1'))
      .limit(1);
    expect(created?.envelope).toMatchObject({
      source: 'adili/declarations',
      tenant: 'psc',
      data: {
        obligationId: expect.any(String) as string,
        rosterRecordId: expect.any(String) as string,
        cycleKey: expect.stringMatching(/^(biennial:2027|initial:2027-06-20)$/) as string,
      },
    });
    expect(created?.envelope.subject).toBe(created?.envelope.data.obligationId);
    // Identifiers and dates only: no names, file numbers or OFRs in events.
    expect(JSON.stringify(created?.envelope)).not.toMatch(/PSC\/|Achieng/);

    const [policy] = await api.asPlatform((tx) => tx.select().from(tenantPolicyCache));
    expect(policy).toMatchObject({ tenant: 'psc', version: 1 });
  });

  it('is a no-op when the same event is delivered again', async () => {
    const importId = randomUUID();
    api.directory.givenImport(importId, rosterOf2500());
    const event = importCompleted(importId);
    await api.consumers.importCompleted(event);
    const pulls = api.directory.pulls.length;

    await api.consumers.importCompleted(event);

    expect(api.directory.pulls).toHaveLength(pulls);
    expect(await tableCount(filingObligations)).toBe(3000);
    expect(await eventCount('obligation.created.v1')).toBe(3000);
    expect(api.workflows.created()).toHaveLength(3000);
  });

  it('changes nothing when a later import has the same records unchanged', async () => {
    const records = rosterOf2500().slice(0, 10);
    const first = randomUUID();
    api.directory.givenImport(first, records);
    await api.consumers.importCompleted(importCompleted(first));
    const second = randomUUID();
    api.directory.givenImport(second, records);

    await api.consumers.importCompleted(importCompleted(second));

    expect(await tableCount(filingObligations)).toBe(12);
    expect(await eventCount('obligation.created.v1')).toBe(12);
  });

  it('commits each page on its own and leaves the event for retry when a pull fails', async () => {
    const importId = randomUUID();
    api.directory.givenImport(importId, rosterOf2500());
    api.directory.failPull(1);
    const event = importCompleted(importId);

    await expect(api.consumers.importCompleted(event)).rejects.toThrow('unreachable');

    expect(await tableCount(rosterSnapshots)).toBe(1000);
    expect(await api.db.select().from(inbox)).toEqual([]);

    await api.consumers.importCompleted(event);

    expect(await tableCount(rosterSnapshots)).toBe(2500);
    expect(await tableCount(filingObligations)).toBe(3000);
    expect(await eventCount('obligation.created.v1')).toBe(3000);
    expect(await api.db.select({ consumer: inbox.consumer }).from(inbox)).toEqual([
      { consumer: 'obligations.roster-import-completed' },
    ]);
  });

  it('leaves the event for retry when the policy cannot be pulled', async () => {
    const importId = randomUUID();
    api.directory.givenImport(importId, rosterOf2500().slice(0, 3));
    const event = importCompleted(importId, 'tsc');

    await expect(api.consumers.importCompleted(event)).rejects.toThrow();

    expect(await api.db.select().from(inbox)).toEqual([]);
    expect(await tableCount(rosterSnapshots)).toBe(0);
  });

  it('creates no initial for appointments before the obligations-start date', async () => {
    api.directory.givenCommission(
      'psc',
      'Public Service Commission',
      policyVersion({ obligationsStartDate: '2027-07-01' }),
    );
    const importId = randomUUID();
    api.directory.givenImport(importId, [rosterRecord('psc', { appointmentDate: '2027-06-20' })]);

    await api.consumers.importCompleted(importCompleted(importId));

    const types = await asPlatform((tx) =>
      tx.select({ type: filingObligations.type }).from(filingObligations),
    );
    expect(types).toEqual([{ type: 'biennial' }]);
  });

  it('records the reminders already past when an obligation is created as skipped', async () => {
    const importId = randomUUID();
    // Appointed 2027-05-01: due 2027-05-31, so every reminder was before today.
    api.directory.givenImport(importId, [rosterRecord('psc', { appointmentDate: '2027-05-01' })]);

    await api.consumers.importCompleted(importCompleted(importId));

    const reminders = await asPlatform((tx) =>
      tx
        .select({
          type: filingObligations.type,
          status: filingObligations.status,
          offsetDays: obligationReminders.offsetDays,
          outcome: obligationReminders.outcome,
          sentAt: obligationReminders.sentAt,
        })
        .from(obligationReminders)
        .innerJoin(filingObligations, eq(filingObligations.id, obligationReminders.obligationId))
        .orderBy(sql`${obligationReminders.offsetDays} desc`),
    );
    expect(reminders).toEqual(
      [30, 14, 7].map((offsetDays) => ({
        type: 'initial',
        status: 'overdue',
        offsetDays,
        outcome: 'skipped-past-due-at-creation',
        sentAt: null,
      })),
    );
  });
});

describe('S9 declarant.onboarded.v1', () => {
  it('links the person id and OFR on the snapshot and its obligations, and signals personLinked', async () => {
    const importId = randomUUID();
    const record = rosterRecord('psc', { appointmentDate: '2027-06-20' });
    api.directory.givenImport(importId, [record]);
    await api.consumers.importCompleted(importCompleted(importId));
    const personId = randomUUID();
    api.directory.givenRecords([
      {
        ...record,
        personId,
        ofr: 'OFR-0482913-L',
        onboardedAt: new Date().toISOString(),
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      },
    ]);

    await api.consumers.declarantOnboarded(
      directoryEvent(DECLARANT_ONBOARDED, 'psc', {
        personId,
        ofr: 'OFR-0482913-L',
        rosterRecordId: record.id,
        keycloakUserId: randomUUID(),
        linked: false,
      }),
    );

    const obligations = await asPlatform((tx) =>
      tx
        .select({
          id: filingObligations.id,
          personId: filingObligations.personId,
          ofr: filingObligations.ofr,
        })
        .from(filingObligations)
        .where(eq(filingObligations.rosterRecordId, record.id)),
    );
    expect(obligations).toHaveLength(2);
    expect(obligations.every((o) => o.personId === personId && o.ofr === 'OFR-0482913-L')).toBe(
      true,
    );
    expect(api.workflows.personLinked().sort()).toEqual(obligations.map((o) => o.id).sort());

    const first = obligations[0]?.id ?? '';
    const staffView = await api.get(`/v1/obligations/${first}`, PSC_STAFF);
    expect(staffView.json<ObligationDetail>().declarant).toMatchObject({
      rosterRecordId: record.id,
      onboarded: true,
      ofr: 'OFR-0482913-L',
    });
    const declarantView = await api.get('/v1/me/obligations', { personId, roles: ['declarant'] });
    expect(declarantView.json<{ groups: unknown[] }>().groups).toHaveLength(1);
    // No new obligations, so no created events beyond the import's.
    expect(await eventCount('obligation.created.v1')).toBe(2);
  });

  it("creates a record's obligations, already linked, when the import was never seen", async () => {
    const personId = randomUUID();
    const record = rosterRecord('psc', { personId, ofr: 'OFR-0000417-4' });
    api.directory.givenRecords([record]);

    await api.consumers.declarantOnboarded(
      directoryEvent(DECLARANT_ONBOARDED, 'psc', {
        personId,
        ofr: 'OFR-0000417-4',
        rosterRecordId: record.id,
        keycloakUserId: randomUUID(),
        linked: true,
      }),
    );

    const obligations = await asPlatform((tx) =>
      tx
        .select({ type: filingObligations.type, personId: filingObligations.personId })
        .from(filingObligations)
        .where(and(eq(filingObligations.rosterRecordId, record.id))),
    );
    expect(obligations).toEqual([{ type: 'biennial', personId }]);
    expect(api.workflows.personLinked()).toEqual([]);
  });

  it('does not let an older pull overwrite a newer snapshot', async () => {
    const personId = randomUUID();
    const onboarded = rosterRecord('psc', {
      personId,
      ofr: 'OFR-0000417-4',
      updatedAt: '2027-07-10T09:00:00.000Z',
    });
    api.directory.givenRecords([onboarded]);
    await api.consumers.declarantOnboarded(
      directoryEvent(DECLARANT_ONBOARDED, 'psc', {
        personId,
        ofr: 'OFR-0000417-4',
        rosterRecordId: onboarded.id,
        keycloakUserId: randomUUID(),
        linked: false,
      }),
    );
    const importId = randomUUID();
    api.directory.givenImport(importId, [
      { ...onboarded, personId: null, ofr: null, updatedAt: '2027-07-10T08:00:00.000Z' },
    ]);

    await api.consumers.importCompleted(importCompleted(importId));

    const [snapshot] = await asPlatform((tx) =>
      tx.select({ personId: rosterSnapshots.personId }).from(rosterSnapshots),
    );
    expect(snapshot?.personId).toBe(personId);
  });
});

describe('#91 statuses recomputed on ingest', () => {
  /** An officer appointed 2027-06-20: initial due 2027-07-20, and the 2027 biennial (1 Nov). */
  const appointed = rosterRecord('psc', { appointmentDate: '2027-06-20' });

  async function ingest() {
    const importId = randomUUID();
    api.directory.givenImport(importId, [appointed]);
    await api.consumers.importCompleted(importCompleted(importId));
  }

  async function statuses() {
    const rows = await asPlatform((tx) =>
      tx
        .select({ type: filingObligations.type, status: filingObligations.status })
        .from(filingObligations)
        .where(eq(filingObligations.rosterRecordId, appointed.id))
        .orderBy(asc(filingObligations.type)),
    );
    return Object.fromEntries(rows.map((row) => [row.type, row.status]));
  }

  async function statusEvents() {
    const rows = await api.db
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, 'obligation.status-changed.v1'))
      .orderBy(asc(outbox.id));
    return rows.map((row) => row.envelope.data);
  }

  it("moves open obligations on to the engine's status for today, with one event each, once", async () => {
    await ingest();
    expect(await statuses()).toEqual({ biennial: 'upcoming', initial: 'due' });

    // A later import, after the initial's due date and the biennial's statement date.
    api.clock.setToday('2027-11-02');
    await ingest();
    await ingest();

    expect(await statuses()).toEqual({ biennial: 'due', initial: 'overdue' });
    // One event per obligation; the two are written in no set order.
    const events = await statusEvents();
    expect(events.sort((a, b) => (a.from as string).localeCompare(b.from as string))).toEqual([
      expect.objectContaining({ from: 'due', to: 'overdue', reason: null }),
      expect.objectContaining({ from: 'upcoming', to: 'due', reason: null }),
    ]);
  });

  it('never moves a status back: an ingest that planned from an earlier day leaves it', async () => {
    await ingest();
    const initial = await asPlatform(async (tx) => {
      const [row] = await tx
        .select({ id: filingObligations.id })
        .from(filingObligations)
        .where(
          and(
            eq(filingObligations.rosterRecordId, appointed.id),
            eq(filingObligations.type, 'initial'),
          ),
        );
      return row?.id ?? '';
    });
    // The workflow moved it on at midnight after the due date, while this ingest's day was earlier.
    await api.steps.setStatus({ obligationId: initial, tenant: 'psc' }, 'overdue');

    await ingest();

    expect(await statuses()).toEqual({ biennial: 'upcoming', initial: 'overdue' });
    expect(await statusEvents()).toEqual([expect.objectContaining({ from: 'due', to: 'overdue' })]);
  });

  it('leaves filed and cancelled obligations alone', async () => {
    await ingest();
    await asPlatform((tx) =>
      tx
        .update(filingObligations)
        .set({ status: 'filed' })
        .where(
          and(
            eq(filingObligations.rosterRecordId, appointed.id),
            eq(filingObligations.type, 'initial'),
          ),
        ),
    );
    api.clock.setToday('2027-11-02');

    await ingest();

    expect(await statuses()).toEqual({ biennial: 'due', initial: 'filed' });
  });
});
