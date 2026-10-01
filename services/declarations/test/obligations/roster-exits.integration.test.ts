import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  filingObligations,
  inbox,
  obligationReminders,
  outbox,
  rosterSnapshots,
} from '../../src/db/schema.js';
import type { PulledRosterRecord } from '../../src/directory/directory-client.js';
import type { Transaction } from '../../src/obligations/apply-page.js';
import { ROSTER_EXITS_CONFIRMED, ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Spec 04 S8 and the corrections of #91 at the inbox seam: confirmed exits and re-imports that
 * reverse an exit or correct an appointment date keep the obligations true, against real
 * Postgres with a fake directory. Filed obligations are never changed.
 *
 * Today is 2027-07-10 unless a test moves it: the 2027 cycle opened on 2027-07-04 (statement
 * date 1 November, due 31 December) and PSC's obligations start on 2027-01-01.
 */

const TODAY = '2027-07-10';

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
  version = 0;
});

/** Each version of a record the directory hands out is newer than the last. */
let version = 0;
function nextUpdatedAt(): string {
  version += 1;
  return new Date(Date.UTC(2027, 6, 1) + version * 1000).toISOString();
}

function longServing(overrides: Partial<PulledRosterRecord> = {}): PulledRosterRecord {
  return rosterRecord('psc', {
    appointmentDate: '2012-10-01',
    updatedAt: nextUpdatedAt(),
    ...overrides,
  });
}

/** The record as the directory has it after confirming its exit on `exitDate`. */
function exited(record: PulledRosterRecord, exitDate: string): PulledRosterRecord {
  return { ...record, state: 'exited', exitDate, updatedAt: nextUpdatedAt() };
}

/** The record as the directory has it after a re-import: `changes` applied, any exit reversed. */
function reimported(
  record: PulledRosterRecord,
  changes: Partial<PulledRosterRecord> = {},
): PulledRosterRecord {
  return {
    ...record,
    state: record.personId === null ? 'not_onboarded' : 'onboarded',
    exitDate: null,
    updatedAt: nextUpdatedAt(),
    ...changes,
  };
}

async function imported(records: PulledRosterRecord[]): Promise<string> {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
  );
  return importId;
}

function exitsConfirmed(batchId: string, records: readonly PulledRosterRecord[]) {
  return directoryEvent(ROSTER_EXITS_CONFIRMED, 'psc', {
    batchId,
    count: records.length,
    source: 'console',
    recordIds: records.map((record) => record.id),
    actor: { kind: 'user', id: 'officer-psc' },
  });
}

async function confirmedExits(records: PulledRosterRecord[]): Promise<string> {
  const batchId = randomUUID();
  api.directory.givenExitBatch(batchId, records);
  await api.consumers.exitsConfirmed(exitsConfirmed(batchId, records));
  return batchId;
}

/** Reads as the platform (every tenant), as a test looking behind the API. */
function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

/** The record's obligations, cancelled ones included, oldest first. */
function obligationsOf(record: PulledRosterRecord) {
  return asPlatform((tx) =>
    tx
      .select({
        id: filingObligations.id,
        cycleKey: filingObligations.cycleKey,
        statementDate: filingObligations.statementDate,
        dueDate: filingObligations.dueDate,
        status: filingObligations.status,
        cancelReason: filingObligations.cancelReason,
        personId: filingObligations.personId,
      })
      .from(filingObligations)
      .where(eq(filingObligations.rosterRecordId, record.id))
      .orderBy(asc(filingObligations.id)),
  );
}

async function obligationIdOf(record: PulledRosterRecord, cycleKey: string): Promise<string> {
  const live = (await obligationsOf(record)).filter(
    (o) => o.cycleKey === cycleKey && o.status !== 'cancelled',
  );
  expect(live).toHaveLength(1);
  return live[0]?.id ?? '';
}

function snapshotOf(record: PulledRosterRecord) {
  return asPlatform(async (tx) => {
    const [row] = await tx
      .select({
        state: rosterSnapshots.state,
        appointmentDate: rosterSnapshots.appointmentDate,
        exitDate: rosterSnapshots.exitDate,
        personId: rosterSnapshots.personId,
        syncedFrom: rosterSnapshots.syncedFrom,
      })
      .from(rosterSnapshots)
      .where(eq(rosterSnapshots.rosterRecordId, record.id));
    return row;
  });
}

async function eventsOf(type: string) {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type))
    .orderBy(asc(outbox.id));
  return rows.map((row) => row.envelope.data);
}

async function skippedOffsets(obligationId: string): Promise<number[]> {
  const rows = await asPlatform((tx) =>
    tx
      .select({ offsetDays: obligationReminders.offsetDays, outcome: obligationReminders.outcome })
      .from(obligationReminders)
      .where(eq(obligationReminders.obligationId, obligationId)),
  );
  expect(rows.every((row) => row.outcome === 'skipped-past-due-at-creation')).toBe(true);
  return rows.map((row) => row.offsetDays).sort((a, b) => b - a);
}

async function markFiled(obligationId: string): Promise<void> {
  await asPlatform((tx) =>
    tx
      .update(filingObligations)
      .set({ status: 'filed', filedDeclarationId: randomUUID() })
      .where(eq(filingObligations.id, obligationId)),
  );
}

describe('S8 roster.exits.confirmed.v1', () => {
  it('pulls the batch, creates finals and cancels the upcoming biennials, with events', async () => {
    const personId = randomUUID();
    const amina = longServing({ personId, ofr: 'OFR-0482913-L', state: 'onboarded' });
    const baraka = longServing();
    const chebet = longServing({ appointmentDate: '2027-06-20' });
    await imported([amina, baraka, chebet]);
    const aminaBiennial = await obligationIdOf(amina, 'biennial:2027');
    const chebetBiennial = await obligationIdOf(chebet, 'biennial:2027');
    const createdBefore = (await eventsOf('obligation.created.v1')).length;
    api.workflows.reset();
    api.directory.pulls.length = 0;

    const batchId = await confirmedExits([
      exited(amina, '2027-07-05'),
      exited(chebet, '2027-07-08'),
    ]);

    expect(api.directory.pulls).toEqual([`psc ${batchId} -`]);
    expect(await obligationsOf(amina)).toEqual([
      expect.objectContaining({
        id: aminaBiennial,
        cycleKey: 'biennial:2027',
        status: 'cancelled',
        cancelReason: 'exited-before-statement-date',
      }),
      expect.objectContaining({
        cycleKey: 'final:2027-07-05',
        statementDate: '2027-07-05',
        dueDate: '2027-08-04',
        status: 'due',
        cancelReason: null,
        personId,
      }),
    ]);
    // Chebet's initial stays: the appointment still happened.
    expect(await obligationsOf(chebet)).toEqual([
      expect.objectContaining({ cycleKey: 'initial:2027-06-20', status: 'due' }),
      expect.objectContaining({
        id: chebetBiennial,
        status: 'cancelled',
        cancelReason: 'exited-before-statement-date',
      }),
      expect.objectContaining({
        cycleKey: 'final:2027-07-08',
        dueDate: '2027-08-07',
        status: 'due',
      }),
    ]);
    expect(await obligationsOf(baraka)).toEqual([
      expect.objectContaining({ cycleKey: 'biennial:2027', status: 'upcoming' }),
    ]);

    const aminaFinal = await obligationIdOf(amina, 'final:2027-07-05');
    const chebetFinal = await obligationIdOf(chebet, 'final:2027-07-08');
    // Due 2027-08-04: the 30-day reminder (2027-07-05) was already past.
    expect(await skippedOffsets(aminaFinal)).toEqual([30]);

    const created = (await eventsOf('obligation.created.v1')).slice(createdBefore);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ obligationId: aminaFinal, type: 'final' }),
        expect.objectContaining({ obligationId: chebetFinal, type: 'final' }),
      ]),
    );
    expect(created).toHaveLength(2);
    expect(await eventsOf('obligation.status-changed.v1')).toEqual(
      expect.arrayContaining(
        [aminaBiennial, chebetBiennial].map((obligationId) => ({
          obligationId,
          from: 'upcoming',
          to: 'cancelled',
          reason: 'exited-before-statement-date',
        })),
      ),
    );
    expect(api.workflows.created().sort()).toEqual([aminaFinal, chebetFinal].sort());
    expect(api.workflows.cancelled()).toEqual(
      expect.arrayContaining(
        [aminaBiennial, chebetBiennial].map((obligationId) => ({
          obligationId,
          reason: 'exited-before-statement-date',
        })),
      ),
    );

    expect(await snapshotOf(amina)).toEqual({
      state: 'exited',
      appointmentDate: '2012-10-01',
      exitDate: '2027-07-05',
      personId,
      syncedFrom: batchId,
    });
  });

  it('keeps the biennial when the declarant exited after its statement date', async () => {
    api.clock.setToday('2027-11-25');
    const declarant = longServing();
    await imported([declarant]);

    await confirmedExits([exited(declarant, '2027-11-20')]);

    expect(await obligationsOf(declarant)).toEqual([
      expect.objectContaining({ cycleKey: 'biennial:2027', status: 'due', cancelReason: null }),
      expect.objectContaining({
        cycleKey: 'final:2027-11-20',
        dueDate: '2027-12-20',
        status: 'due',
      }),
    ]);
    expect(await eventsOf('obligation.status-changed.v1')).toEqual([]);
  });

  it('cancels a biennial already due when the exit before its statement date is confirmed late', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const biennial = await obligationIdOf(declarant, 'biennial:2027');
    // The workflow moved it to due on the statement date.
    await asPlatform((tx) =>
      tx.update(filingObligations).set({ status: 'due' }).where(eq(filingObligations.id, biennial)),
    );
    api.clock.setToday('2027-11-05');

    await confirmedExits([exited(declarant, '2027-10-20')]);

    expect(await eventsOf('obligation.status-changed.v1')).toEqual([
      {
        obligationId: biennial,
        from: 'due',
        to: 'cancelled',
        reason: 'exited-before-statement-date',
      },
    ]);
    expect((await obligationsOf(declarant)).map((o) => [o.cycleKey, o.status])).toEqual([
      ['biennial:2027', 'cancelled'],
      ['final:2027-10-20', 'due'],
    ]);
  });

  it('creates a final already overdue when the exit is confirmed late', async () => {
    const declarant = longServing();
    await imported([declarant]);

    await confirmedExits([exited(declarant, '2027-05-01')]);

    const final = await obligationIdOf(declarant, 'final:2027-05-01');
    expect((await obligationsOf(declarant)).find((o) => o.id === final)).toMatchObject({
      dueDate: '2027-05-31',
      status: 'overdue',
    });
    expect(await skippedOffsets(final)).toEqual([30, 14, 7]);
  });

  it('creates the final of a declarant whose import was never seen', async () => {
    const declarant = exited(longServing(), '2027-07-01');

    await confirmedExits([declarant]);

    expect(await obligationsOf(declarant)).toEqual([
      expect.objectContaining({ cycleKey: 'final:2027-07-01', status: 'due' }),
    ]);
    expect(await snapshotOf(declarant)).toMatchObject({ state: 'exited', exitDate: '2027-07-01' });
  });

  it('is a no-op when the same event is delivered again', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const batchId = randomUUID();
    const records = [exited(declarant, '2027-07-05')];
    api.directory.givenExitBatch(batchId, records);
    const event = exitsConfirmed(batchId, records);
    await api.consumers.exitsConfirmed(event);
    const before = {
      obligations: await obligationsOf(declarant),
      created: await eventsOf('obligation.created.v1'),
      changed: await eventsOf('obligation.status-changed.v1'),
      pulls: api.directory.pulls.length,
      workflowCalls: api.workflows.calls.length,
    };

    await api.consumers.exitsConfirmed(event);

    expect(await obligationsOf(declarant)).toEqual(before.obligations);
    expect(await eventsOf('obligation.created.v1')).toEqual(before.created);
    expect(await eventsOf('obligation.status-changed.v1')).toEqual(before.changed);
    expect(api.directory.pulls).toHaveLength(before.pulls);
    expect(api.workflows.calls).toHaveLength(before.workflowCalls);
    expect(
      await api.db
        .select({ consumer: inbox.consumer })
        .from(inbox)
        .where(eq(inbox.eventId, event.id)),
    ).toEqual([{ consumer: 'obligations.roster-exits-confirmed' }]);
  });

  it('leaves the event for retry when the batch cannot be pulled', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const batchId = randomUUID();
    const records = [exited(declarant, '2027-07-05')];
    api.directory.givenExitBatch(batchId, records);
    api.directory.failPull(0);
    const event = exitsConfirmed(batchId, records);

    await expect(api.consumers.exitsConfirmed(event)).rejects.toThrow('unreachable');
    expect(await obligationsOf(declarant)).toEqual([
      expect.objectContaining({ cycleKey: 'biennial:2027', status: 'upcoming' }),
    ]);

    await api.consumers.exitsConfirmed(event);
    expect((await obligationsOf(declarant)).map((o) => [o.cycleKey, o.status])).toEqual([
      ['biennial:2027', 'cancelled'],
      ['final:2027-07-05', 'due'],
    ]);
  });

  it('rejects an event without a batch id', async () => {
    await expect(
      api.consumers.exitsConfirmed(directoryEvent(ROSTER_EXITS_CONFIRMED, 'psc', { count: 1 })),
    ).rejects.toThrow();
    expect(api.directory.pulls).toEqual([]);
  });
});

describe('exit reversed by a later import', () => {
  it('cancels the final as exit-reversed and recreates the biennial', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const withExit = exited(declarant, '2027-07-05');
    await confirmedExits([withExit]);
    const final = await obligationIdOf(declarant, 'final:2027-07-05');
    api.workflows.reset();

    const importId = await imported([reimported(withExit)]);

    const obligations = await obligationsOf(declarant);
    expect(obligations).toEqual([
      expect.objectContaining({
        cycleKey: 'biennial:2027',
        status: 'cancelled',
        cancelReason: 'exited-before-statement-date',
      }),
      expect.objectContaining({ id: final, status: 'cancelled', cancelReason: 'exit-reversed' }),
      expect.objectContaining({
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'upcoming',
        cancelReason: null,
      }),
    ]);
    const restored = await obligationIdOf(declarant, 'biennial:2027');
    expect((await eventsOf('obligation.status-changed.v1')).at(-1)).toEqual({
      obligationId: final,
      from: 'due',
      to: 'cancelled',
      reason: 'exit-reversed',
    });
    expect((await eventsOf('obligation.created.v1')).at(-1)).toMatchObject({
      obligationId: restored,
      cycleKey: 'biennial:2027',
    });
    expect(api.workflows.cancelled()).toEqual([{ obligationId: final, reason: 'exit-reversed' }]);
    expect(api.workflows.created()).toEqual([restored]);
    expect(await snapshotOf(declarant)).toEqual({
      state: 'not_onboarded',
      appointmentDate: '2012-10-01',
      exitDate: null,
      personId: null,
      syncedFrom: importId,
    });
  });

  it('restores the biennial in the status it has today', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const withExit = exited(declarant, '2027-07-05');
    await confirmedExits([withExit]);
    api.clock.setToday('2027-11-05');

    await imported([reimported(withExit)]);

    const restored = await obligationIdOf(declarant, 'biennial:2027');
    expect((await obligationsOf(declarant)).find((o) => o.id === restored)).toMatchObject({
      status: 'due',
    });
    // Due 2027-12-31: every reminder (1, 17 and 24 December) is still ahead.
    expect(await skippedOffsets(restored)).toEqual([]);
  });

  it('gives a new final when the exit is confirmed again, even on the same date', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const firstExit = exited(declarant, '2027-07-05');
    await confirmedExits([firstExit]);
    const reversed = reimported(firstExit);
    await imported([reversed]);

    await confirmedExits([exited(reversed, '2027-07-05')]);

    expect(
      (await obligationsOf(declarant)).map((o) => [o.cycleKey, o.status, o.cancelReason]),
    ).toEqual([
      ['biennial:2027', 'cancelled', 'exited-before-statement-date'],
      ['final:2027-07-05', 'cancelled', 'exit-reversed'],
      ['biennial:2027', 'cancelled', 'exited-before-statement-date'],
      ['final:2027-07-05', 'due', null],
    ]);
  });

  it('never touches a filed final', async () => {
    const declarant = longServing();
    await imported([declarant]);
    const withExit = exited(declarant, '2027-07-05');
    await confirmedExits([withExit]);
    const final = await obligationIdOf(declarant, 'final:2027-07-05');
    await markFiled(final);

    await imported([reimported(withExit)]);

    expect((await obligationsOf(declarant)).find((o) => o.id === final)).toMatchObject({
      status: 'filed',
      cancelReason: null,
    });
    expect(api.workflows.cancelled().map((c) => c.obligationId)).not.toContain(final);
  });
});

describe('appointment date corrected by a later import', () => {
  it('supersedes the initial with one on the new dates', async () => {
    const declarant = longServing({ appointmentDate: '2027-06-20' });
    await imported([declarant]);
    const initial = await obligationIdOf(declarant, 'initial:2027-06-20');
    const biennial = await obligationIdOf(declarant, 'biennial:2027');
    api.workflows.reset();

    await imported([reimported(declarant, { appointmentDate: '2027-06-25' })]);

    expect(await obligationsOf(declarant)).toEqual([
      expect.objectContaining({ id: initial, status: 'cancelled', cancelReason: 'superseded' }),
      expect.objectContaining({ id: biennial, status: 'upcoming' }),
      expect.objectContaining({
        cycleKey: 'initial:2027-06-25',
        statementDate: '2027-06-25',
        dueDate: '2027-07-25',
        status: 'due',
        cancelReason: null,
      }),
    ]);
    const replacement = await obligationIdOf(declarant, 'initial:2027-06-25');
    expect((await eventsOf('obligation.status-changed.v1')).at(-1)).toEqual({
      obligationId: initial,
      from: 'due',
      to: 'cancelled',
      reason: 'superseded',
    });
    expect((await eventsOf('obligation.created.v1')).at(-1)).toMatchObject({
      obligationId: replacement,
      type: 'initial',
      statementDate: '2027-06-25',
      dueDate: '2027-07-25',
    });
    expect(api.workflows.cancelled()).toEqual([{ obligationId: initial, reason: 'superseded' }]);
    expect(api.workflows.created()).toEqual([replacement]);
    expect(await snapshotOf(declarant)).toMatchObject({ appointmentDate: '2027-06-25' });
  });

  it('computes the new initial status as of today', async () => {
    const declarant = longServing({ appointmentDate: '2027-06-20' });
    await imported([declarant]);

    // HR corrects the appointment to months earlier: the initial was due long ago.
    await imported([reimported(declarant, { appointmentDate: '2027-03-10' })]);

    const replacement = await obligationIdOf(declarant, 'initial:2027-03-10');
    expect((await obligationsOf(declarant)).find((o) => o.id === replacement)).toMatchObject({
      dueDate: '2027-04-09',
      status: 'overdue',
    });
    expect(await skippedOffsets(replacement)).toEqual([30, 14, 7]);
  });

  it('cancels the initial when the corrected date is before the obligations-start date', async () => {
    const declarant = longServing({ appointmentDate: '2027-06-20' });
    await imported([declarant]);
    const initial = await obligationIdOf(declarant, 'initial:2027-06-20');

    await imported([reimported(declarant, { appointmentDate: '2026-12-01' })]);

    expect(
      (await obligationsOf(declarant)).map((o) => [o.cycleKey, o.status, o.cancelReason]),
    ).toEqual([
      ['initial:2027-06-20', 'cancelled', 'superseded'],
      ['biennial:2027', 'upcoming', null],
    ]);
    expect(api.workflows.cancelled()).toContainEqual({
      obligationId: initial,
      reason: 'superseded',
    });
  });

  it('never touches a filed initial, and creates no replacement', async () => {
    const declarant = longServing({ appointmentDate: '2027-06-20' });
    await imported([declarant]);
    const initial = await obligationIdOf(declarant, 'initial:2027-06-20');
    await markFiled(initial);
    const before = await obligationsOf(declarant);
    const events = (await eventsOf('obligation.created.v1')).length;

    await imported([reimported(declarant, { appointmentDate: '2027-06-25' })]);

    expect(await obligationsOf(declarant)).toEqual(before);
    expect(await eventsOf('obligation.created.v1')).toHaveLength(events);
    expect(await eventsOf('obligation.status-changed.v1')).toEqual([]);
    expect(await snapshotOf(declarant)).toMatchObject({ appointmentDate: '2027-06-25' });
  });
});
