import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  filingObligations,
  obligationReminders,
  outbox,
} from '../../src/db/schema.js';
import type { Transaction } from '../../src/obligations/apply-page.js';
import { ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import {
  type ChannelProgress,
  type ReminderAttempt,
  reminderMessageKey,
  ReminderRetryable,
} from '../../src/obligations/workflow/obligation-steps.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { policyVersion, rosterRecord } from '../support/fake-directory.js';

/**
 * The steps `FilingObligationWorkflow`'s activities take (S11 and the reminder rules), against
 * real Postgres with the fake notifications client: statuses, reminder rows and events.
 *
 * Today is 2027-07-10. The declarant was appointed on 2027-07-01: an initial due 2027-07-31 whose
 * 30-day reminder (1 July) was already past at creation, and the 14 and 7-day ones (17 and 24
 * July) ahead; the 2027 biennial is upcoming.
 */
const TODAY = '2027-07-10';
const PERSON = '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47';

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

function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

/** Imports one declarant and returns the ids of their initial and biennial obligations. */
async function declarant(personId: string | null = null) {
  const record = rosterRecord('psc', {
    appointmentDate: '2027-07-01',
    personId,
    ofr: personId && 'OFR-0000417-4',
  });
  const importId = randomUUID();
  api.directory.givenImport(importId, [record]);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
  );
  const rows = await asPlatform((tx) =>
    tx
      .select({ id: filingObligations.id, type: filingObligations.type })
      .from(filingObligations)
      .where(eq(filingObligations.rosterRecordId, record.id)),
  );
  const idOf = (type: string) => rows.find((row) => row.type === type)?.id ?? '';
  return { initial: idOf('initial'), biennial: idOf('biennial') };
}

function reminder(obligationId: string, offsetDays = 14) {
  return { obligationId, tenant: 'psc', offsetDays, scheduledAt: '2027-07-17T10:41:07.000Z' };
}

const psc = (obligationId: string) => ({ obligationId, tenant: 'psc' });

/** An attempt as Temporal would run it; `saved` is what it heartbeated. */
function attempt(last = true, progress: ChannelProgress = {}) {
  const saved: ChannelProgress[] = [];
  const run: ReminderAttempt = {
    last,
    progress,
    save: (p) => {
      saved.push(structuredClone(p));
    },
  };
  return { run, saved };
}

async function remindersOf(obligationId: string) {
  return asPlatform((tx) =>
    tx
      .select()
      .from(obligationReminders)
      .where(eq(obligationReminders.obligationId, obligationId))
      .orderBy(asc(obligationReminders.offsetDays)),
  );
}

async function events(type: string) {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type));
  return rows.map((row) => row.envelope);
}

/** `obligation.reminder.recorded.v1` events but those of reminders past at creation. */
async function sentByWorkflow() {
  return (await events('obligation.reminder.recorded.v1')).filter(
    (e) => e.data.outcome !== 'skipped-past-due-at-creation',
  );
}

describe('sendReminder', () => {
  it('S11: records skipped-not-onboarded without calling notifications when no person is linked', async () => {
    const { initial } = await declarant();

    await expect(api.steps.sendReminder(reminder(initial), attempt().run)).resolves.toBe(
      'skipped-not-onboarded',
    );

    expect(api.notifications.sent).toEqual([]);
    const row = (await remindersOf(initial)).find((r) => r.offsetDays === 14);
    expect(row).toMatchObject({
      outcome: 'skipped-not-onboarded',
      channels: [],
      messageIds: [],
      sentAt: null,
      scheduledAt: new Date('2027-07-17T10:41:07.000Z'),
      tenant: 'psc',
    });
    expect((await sentByWorkflow()).map((e) => e.data)).toEqual([
      { obligationId: initial, offsetDays: 14, channels: [], outcome: 'skipped-not-onboarded' },
    ]);
  });

  it('S11: sends SMS and email to the linked person and records both message ids and an event', async () => {
    const { initial } = await declarant(PERSON);

    await expect(api.steps.sendReminder(reminder(initial), attempt().run)).resolves.toBe('sent');

    expect(api.notifications.sent).toEqual(
      (['sms', 'email'] as const).map((channel) => ({
        channel,
        personId: PERSON,
        tenant: 'psc',
        params: {
          type: 'initial',
          commissionName: 'Public Service Commission',
          statementDate: '2027-07-01',
          dueDate: '2027-07-31',
          // The 14-day reminder, planned for 17 July.
          daysLeft: 14,
          portalUrl: 'http://localhost:3010',
        },
        idempotencyKey: reminderMessageKey(reminder(initial), channel),
        messageId: expect.any(String) as string,
      })),
    );
    const row = (await remindersOf(initial)).find((r) => r.offsetDays === 14);
    expect(row).toMatchObject({
      outcome: 'sent',
      channels: ['sms', 'email'],
      messageIds: api.notifications.sent.map((m) => m.messageId),
      sentAt: api.clock.now(),
    });
    const [event] = await sentByWorkflow();
    expect(event).toMatchObject({
      tenant: 'psc',
      subject: initial,
      data: { obligationId: initial, offsetDays: 14, channels: ['sms', 'email'], outcome: 'sent' },
    });
    // Identifiers only: no person, contact or OFR in the event.
    expect(JSON.stringify(event)).not.toContain(PERSON);
  });

  it('records skipped-no-contact when the person has no contact on either channel', async () => {
    const { initial } = await declarant(PERSON);
    api.notifications.answer('sms', { failed: 'no-contact' });
    api.notifications.answer('email', { failed: 'no-contact' });

    await expect(api.steps.sendReminder(reminder(initial), attempt(false).run)).resolves.toBe(
      'skipped-no-contact',
    );
    expect((await remindersOf(initial)).find((r) => r.offsetDays === 14)?.channels).toEqual([]);
  });

  it('counts a reminder sent on the one channel with a contact', async () => {
    const { initial } = await declarant(PERSON);
    api.notifications.answer('sms', { failed: 'no-contact' });

    await expect(api.steps.sendReminder(reminder(initial), attempt(false).run)).resolves.toBe(
      'sent',
    );
    expect((await remindersOf(initial)).find((r) => r.offsetDays === 14)).toMatchObject({
      channels: ['email'],
      messageIds: [api.notifications.sent[1]?.messageId],
    });
  });

  it('asks for a retry when a channel failed for now, and never sends a channel twice', async () => {
    const { initial } = await declarant(PERSON);
    api.notifications.answer('sms', 'unreachable', { failed: 'provider-error' });
    const first = attempt(false);

    await expect(api.steps.sendReminder(reminder(initial), first.run)).rejects.toBeInstanceOf(
      ReminderRetryable,
    );
    expect(await remindersOf(initial)).toHaveLength(1); // only the one skipped at creation
    const progress = first.saved.at(-1) ?? {};
    expect(progress.email).toMatchObject({ status: 'sent' });

    // The last attempt: SMS fails again, so the reminder counts as sent by email only.
    await expect(
      api.steps.sendReminder(reminder(initial), attempt(true, progress).run),
    ).resolves.toBe('sent');
    expect(api.notifications.channels()).toEqual(['sms', 'email', 'sms']);
    expect((await remindersOf(initial)).find((r) => r.offsetDays === 14)).toMatchObject({
      outcome: 'sent',
      channels: ['email'],
    });
  });

  it('does not retry a channel that timed out at the provider: it may have been delivered', async () => {
    const { initial } = await declarant(PERSON);
    api.notifications.answer('sms', { failed: 'timeout' });

    await expect(api.steps.sendReminder(reminder(initial), attempt(false).run)).resolves.toBe(
      'sent',
    );
    expect(api.notifications.channels()).toEqual(['sms', 'email']);
    expect((await remindersOf(initial)).find((r) => r.offsetDays === 14)).toMatchObject({
      outcome: 'sent',
      channels: ['email'],
    });
  });

  it('sends each channel of a reminder with its own Idempotency-Key, the same on every attempt', async () => {
    const { initial } = await declarant(PERSON);
    api.notifications.answer('sms', 'unreachable', 'sent');

    await expect(
      api.steps.sendReminder(reminder(initial), attempt(false).run),
    ).rejects.toBeInstanceOf(ReminderRetryable);
    await api.steps.sendReminder(reminder(initial), attempt(true).run);

    const [sms1, email1, sms2, email2] = api.notifications.sent;
    expect(sms1?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(sms2?.idempotencyKey).toBe(sms1?.idempotencyKey);
    expect(email2?.idempotencyKey).toBe(email1?.idempotencyKey);
    expect(email1?.idempotencyKey).not.toBe(sms1?.idempotencyKey);
    // Another reminder of the same obligation has other keys.
    await api.steps.sendReminder(reminder(initial, 7), attempt(true).run);
    expect(api.notifications.sent.at(-1)?.idempotencyKey).not.toBe(email1?.idempotencyKey);
  });

  it('resends the body of its first attempt, so a Commission renamed between attempts does not break the Idempotency-Key', async () => {
    const { initial } = await declarant(PERSON);
    // The first SMS reached notifications, but its answer did not come back in time.
    api.notifications.answer('sms', 'lost');
    const first = attempt(false);
    await expect(api.steps.sendReminder(reminder(initial), first.run)).rejects.toBeInstanceOf(
      ReminderRetryable,
    );
    await asPlatform((tx) =>
      tx
        .update(commissionRefs)
        .set({ name: 'Public Service Commission of Kenya' })
        .where(eq(commissionRefs.slug, 'psc')),
    );

    await expect(
      api.steps.sendReminder(reminder(initial), attempt(true, first.saved.at(-1)).run),
    ).resolves.toBe('sent');

    const [sms1, , sms2] = api.notifications.sent;
    expect(sms2?.params).toEqual(sms1?.params);
    expect(sms2?.params.commissionName).toBe('Public Service Commission');
    expect((await remindersOf(initial)).find((r) => r.offsetDays === 14)).toMatchObject({
      outcome: 'sent',
      channels: ['sms', 'email'],
    });
  });

  it('counts a channel whose key was taken by another message as failed, without sending it again', async () => {
    const { initial } = await declarant(PERSON);
    // Another body under the SMS key: what notifications answers is 422.
    await api.notifications.sendReminder({
      channel: 'sms',
      personId: PERSON,
      tenant: 'psc',
      params: {
        type: 'initial',
        commissionName: 'Someone else',
        statementDate: '2027-07-01',
        dueDate: '2027-07-31',
        daysLeft: 14,
        portalUrl: 'http://localhost:3010',
      },
      idempotencyKey: reminderMessageKey(reminder(initial), 'sms'),
    });

    await expect(api.steps.sendReminder(reminder(initial), attempt(false).run)).resolves.toBe(
      'sent',
    );
    expect((await remindersOf(initial)).find((r) => r.offsetDays === 14)).toMatchObject({
      outcome: 'sent',
      channels: ['email'],
    });
  });

  it("counts the days left from the reminder's planned day, so a retried request is the same", async () => {
    const { initial } = await declarant(PERSON);
    // Planned for 17 July, sent late on 20 July: still "14 days" (due 31 July).
    api.clock.setToday('2027-07-20');

    await api.steps.sendReminder(reminder(initial), attempt(true).run);

    expect(api.notifications.sent.map((m) => m.params.daysLeft)).toEqual([14, 14]);
  });

  it('records failed when the last attempt sent nothing', async () => {
    const { initial } = await declarant(PERSON);
    api.notifications.answer('sms', { failed: 'timeout' });
    api.notifications.answer('email', { failed: 'rejected-recipient' });

    await expect(api.steps.sendReminder(reminder(initial), attempt(true).run)).resolves.toBe(
      'failed',
    );
    expect((await sentByWorkflow()).map((e) => e.data.outcome)).toEqual(['failed']);
  });

  it('does not send a reminder already recorded again', async () => {
    const { initial } = await declarant(PERSON);
    await api.steps.sendReminder(reminder(initial), attempt().run);

    await expect(api.steps.sendReminder(reminder(initial), attempt().run)).resolves.toBe('sent');
    // The 30-day reminder was past at creation: recorded skipped, never sent.
    await expect(api.steps.sendReminder(reminder(initial, 30), attempt().run)).resolves.toBe(
      'skipped-past-due-at-creation',
    );

    expect(api.notifications.sent).toHaveLength(2);
    expect(await sentByWorkflow()).toHaveLength(1);
  });

  it('sends nothing and records nothing for an obligation no longer open for reminders', async () => {
    const { initial, biennial } = await declarant(PERSON);
    await asPlatform(async (tx) => {
      await tx
        .update(filingObligations)
        .set({ status: 'cancelled', cancelReason: 'superseded' })
        .where(eq(filingObligations.id, initial));
      await tx
        .update(filingObligations)
        .set({ status: 'overdue' })
        .where(eq(filingObligations.id, biennial));
    });

    await expect(api.steps.sendReminder(reminder(initial), attempt().run)).resolves.toBe(
      'not-open',
    );
    await expect(api.steps.sendReminder(reminder(biennial), attempt().run)).resolves.toBe(
      'not-open',
    );
    expect(api.notifications.sent).toEqual([]);
    expect(await remindersOf(biennial)).toEqual([]);
  });
});

describe('setStatus, loadObligation, recordSkipped', () => {
  it('moves an open obligation on with one status-changed event, and leaves a cancelled one', async () => {
    const { initial, biennial } = await declarant();

    await expect(api.steps.setStatus(psc(biennial), 'due')).resolves.toBe('due');
    await expect(api.steps.setStatus(psc(biennial), 'due')).resolves.toBe('due');
    await asPlatform((tx) =>
      tx
        .update(filingObligations)
        .set({ status: 'cancelled', cancelReason: 'superseded' })
        .where(eq(filingObligations.id, initial)),
    );
    await expect(api.steps.setStatus(psc(initial), 'overdue')).resolves.toBe('cancelled');

    expect((await events('obligation.status-changed.v1')).map((e) => e.data)).toEqual([
      { obligationId: biennial, from: 'upcoming', to: 'due', reason: null },
    ]);
  });

  it('never moves an open status back, so it converges with ingest on the later date-based status', async () => {
    const { initial } = await declarant();

    await expect(api.steps.setStatus(psc(initial), 'overdue')).resolves.toBe('overdue');
    await expect(api.steps.setStatus(psc(initial), 'due')).resolves.toBe('overdue');

    expect((await events('obligation.status-changed.v1')).map((e) => e.data)).toEqual([
      { obligationId: initial, from: 'due', to: 'overdue', reason: null },
    ]);
  });

  it("runs in the obligation's tenant: named with another tenant, a step finds nothing", async () => {
    const { biennial } = await declarant();

    await expect(
      api.steps.setStatus({ obligationId: biennial, tenant: 'tsc' }, 'due'),
    ).resolves.toBe('cancelled');
    const [row] = await asPlatform((tx) =>
      tx
        .select({ status: filingObligations.status })
        .from(filingObligations)
        .where(eq(filingObligations.id, biennial)),
    );
    expect(row?.status).toBe('upcoming');
  });

  it('loads what the workflow plans from: dates, status, offsets of its policy version, reminders recorded', async () => {
    const { initial } = await declarant(PERSON);

    await expect(api.steps.load(initial)).resolves.toEqual({
      obligationId: initial,
      tenant: 'psc',
      type: 'initial',
      statementDate: '2027-07-01',
      dueDate: '2027-07-31',
      status: 'due',
      personLinked: true,
      reminderOffsetsDays: [30, 14, 7],
      recordedOffsets: [30],
      jitterWindowMs: 6 * 60 * 60 * 1000,
    });
    await expect(api.steps.load(randomUUID())).resolves.toBeNull();
  });

  it("plans reminders with the offsets of the obligation's policy version, not a later one (ADR-003 §4)", async () => {
    const { initial } = await declarant(PERSON);
    // Version 2 changes the offsets; the next roster event caches it.
    api.directory.givenCommission(
      'psc',
      'Public Service Commission',
      policyVersion({ id: randomUUID(), version: 2, reminderOffsetsDays: [22, 7, 1] }),
    );
    await declarant();

    await expect(api.steps.load(initial)).resolves.toMatchObject({
      reminderOffsetsDays: [30, 14, 7],
    });
  });

  it('records a missed reminder whose day was after the obligation was created as missed, not past at creation', async () => {
    // Created 2027-07-10, due 2027-07-31: the 25-day reminder (6 July) was already past then;
    // the 21-day one (10 July, the day of creation) and the 14-day one (17 July) were ahead, so a
    // workflow that plans them later missed them.
    const { initial } = await declarant();
    // The test clock says 10 July; the row's created_at is the database's real time.
    await asPlatform((tx) =>
      tx
        .update(filingObligations)
        .set({ createdAt: new Date('2027-07-10T12:00:00+03:00') })
        .where(eq(filingObligations.id, initial)),
    );

    await api.steps.recordSkipped(psc(initial), [
      { offsetDays: 25, scheduledAt: '2027-07-06T09:41:07.000Z' },
      { offsetDays: 21, scheduledAt: '2027-07-10T09:41:07.000Z' },
      { offsetDays: 14, scheduledAt: '2027-07-17T09:41:07.000Z' },
    ]);

    const outcomes = Object.fromEntries(
      (await remindersOf(initial)).map((row) => [row.offsetDays, row.outcome]),
    );
    expect(outcomes).toEqual({
      14: 'skipped-missed',
      21: 'skipped-missed',
      25: 'skipped-past-due-at-creation',
      30: 'skipped-past-due-at-creation',
    });
  });

  it('records reminders missed by the workflow as skipped, once', async () => {
    const { biennial } = await declarant();
    const missed = [{ offsetDays: 30, scheduledAt: '2027-12-01T09:41:07.000Z' }];

    await api.steps.recordSkipped(psc(biennial), missed);
    await api.steps.recordSkipped(psc(biennial), missed);

    const rows = await asPlatform((tx) =>
      tx
        .select({ outcome: obligationReminders.outcome })
        .from(obligationReminders)
        .where(
          and(
            eq(obligationReminders.obligationId, biennial),
            eq(obligationReminders.offsetDays, 30),
          ),
        ),
    );
    expect(rows).toEqual([{ outcome: 'skipped-missed' }]);
    expect(
      (await events('obligation.reminder.recorded.v1'))
        .map((e) => e.data)
        .filter((data) => data.obligationId === biennial),
    ).toEqual([
      {
        obligationId: biennial,
        offsetDays: 30,
        channels: [],
        outcome: 'skipped-missed',
      },
    ]);
  });

  it('announces reminders already past when the obligation was created', async () => {
    const { initial } = await declarant();

    expect(
      (await events('obligation.reminder.recorded.v1'))
        .map((e) => e.data)
        .filter((data) => data.obligationId === initial),
    ).toEqual([
      {
        obligationId: initial,
        offsetDays: 30,
        channels: [],
        outcome: 'skipped-past-due-at-creation',
      },
    ]);
  });
});
