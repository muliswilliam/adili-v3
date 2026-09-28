import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import type { WorkflowHandle } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addDays } from '../../src/obligations/dates.js';
import type { ObligationStatus } from '../../src/obligations/engine.js';
import type { ObligationActivities } from '../../src/obligations/workflow/activities.js';
import {
  cancelSignal,
  filedSignal,
  type LoadedObligation,
  personLinkedSignal,
  type ReminderRequest,
  type SendReminderResult,
  stateQuery,
} from '../../src/obligations/workflow/contract.js';
import { jitterMs } from '../../src/obligations/workflow/timeline.js';
import { filingObligation } from '../../src/obligations/workflow/workflows.js';

/**
 * The test server's clock only moves forward, so each scenario plays in a later year than the one
 * before.
 *
 * S10-S12: `FilingObligationWorkflow` against mocked activities in Temporal's time-skipping test
 * environment. The mocks keep the obligation in memory as the database would and stamp each call
 * with the test server's clock, so the timeline is asserted in (skipped) real time.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/obligations/workflow/workflows.ts', import.meta.url),
);

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const WINDOW = 6 * HOUR;
const BIENNIAL_ID = '0199a000-0000-7000-8000-00000000b010';
const INITIAL_ID = '0199a000-0000-7000-8000-00000000a010';

const at = (iso: string) => new Date(iso);
const nairobi = (date: string, time = '00:00') => at(`${date}T${time}:00+03:00`);
const reminderSlot = (id: string, date: string) =>
  new Date(nairobi(date, '12:00').getTime() + jitterMs(id, WINDOW)).toISOString();

type Activities = { [K in keyof ObligationActivities]: ObligationActivities[K] };

/** The obligation as the mocked activities keep it, and what they were asked to do. */
class FakeObligation {
  readonly statuses: { status: ObligationStatus; at: Date }[] = [];
  readonly reminders: { request: ReminderRequest; result: SendReminderResult; at: Date }[] = [];
  readonly skipped: { offsetDays: number; scheduledAt: string }[] = [];
  personId: string | null = null;
  /** Reminder attempts to fail before one succeeds (Infinity: all fail). */
  failReminders = 0;
  attempts = 0;

  constructor(
    private readonly env: WorkflowTestEnvironment,
    readonly row: LoadedObligation,
  ) {}

  activities(): Activities {
    return {
      loadObligation: vi.fn(() => Promise.resolve({ ...this.row })),
      setStatus: vi.fn(async (_id: string, status: ObligationStatus) => {
        if (this.row.status === 'cancelled' || this.row.status === 'filed') return this.row.status;
        this.row.status = status;
        this.statuses.push({ status, at: await this.env.now() });
        return status;
      }),
      recordSkippedReminders: vi.fn(
        (_id: string, reminders: { offsetDays: number; scheduledAt: string }[]) => {
          this.skipped.push(...reminders);
          return Promise.resolve();
        },
      ),
      sendReminder: vi.fn(async (request: ReminderRequest) => {
        this.attempts += 1;
        if (this.failReminders > 0) {
          this.failReminders -= 1;
          throw new Error('notifications unreachable');
        }
        const result: SendReminderResult =
          this.personId === null ? 'skipped-not-onboarded' : 'sent';
        this.reminders.push({ request, result, at: await this.env.now() });
        return result;
      }),
      sweepObligations: vi.fn(() => Promise.resolve({ started: 0, cancelled: 0 })),
    };
  }

  sentOffsets(): number[] {
    return this.reminders.map((r) => r.request.offsetDays);
  }
}

function biennial(env: WorkflowTestEnvironment, id = BIENNIAL_ID, year = 2027): FakeObligation {
  return new FakeObligation(env, {
    obligationId: id,
    tenant: 'psc',
    type: 'biennial',
    statementDate: `${String(year)}-11-01`,
    dueDate: `${String(year)}-12-31`,
    status: 'upcoming',
    personLinked: false,
    reminderOffsetsDays: [30, 14, 7],
    recordedOffsets: [],
    jitterWindowMs: WINDOW,
  });
}

/** An initial obligation for an appointment on `statementDate`, due 30 days later. */
function initial(env: WorkflowTestEnvironment, id: string, statementDate: string): FakeObligation {
  return new FakeObligation(env, {
    obligationId: id,
    tenant: 'psc',
    type: 'initial',
    statementDate,
    dueDate: addDays(statementDate, 30),
    status: 'due',
    personLinked: false,
    reminderOffsetsDays: [30, 14, 7],
    recordedOffsets: [],
    jitterWindowMs: WINDOW,
  });
}

/** Asserts a call happened at `expected`, give or take the moments activities take to run. */
function expectAround(actual: Date | undefined, expected: Date): void {
  expect(actual).toBeDefined();
  const drift = (actual?.getTime() ?? 0) - expected.getTime();
  expect(drift).toBeGreaterThanOrEqual(0);
  expect(drift).toBeLessThan(MINUTE);
}

/** Runs the 2027 biennial from now until 2 Jan 2028, then cancels it. */
async function playBiennialCycle(env: WorkflowTestEnvironment): Promise<FakeObligation> {
  const obligation = biennial(env);
  obligation.personId = 'person-1';
  await runWorkflow(env, obligation, async (handle) => {
    await env.skipTime({ until: nairobi('2028-01-02') });
    expect(await handle.query(stateQuery)).toMatchObject({
      status: 'overdue',
      remindersRecorded: [30, 14, 7],
      next: null,
    });
    await handle.signal(cancelSignal, 'superseded');
    await expect(handle.result()).resolves.toBe('cancelled');
  });
  return obligation;
}

/** Starts the obligation's workflow and runs `body` once it has read the obligation. */
function runWorkflow<R>(
  env: WorkflowTestEnvironment,
  obligation: FakeObligation,
  body: (handle: WorkflowHandle<typeof filingObligation>) => Promise<R>,
): Promise<R> {
  return env.run(
    filingObligation,
    {
      workflowsPath,
      activities: obligation.activities(),
      args: [{ obligationId: obligation.row.obligationId }],
    },
    async (handle) => {
      // Skipping time before the workflow has read its obligation would skip its first steps.
      await vi.waitFor(async () => {
        expect((await handle.query(stateQuery)).status).not.toBeNull();
      });
      return body(handle);
    },
  );
}

describe('FilingObligationWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
    // The test server starts at today's date; the scenarios play out in the 2027 cycle.
    await env.skipTime({ until: nairobi('2027-01-01') });
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  const run = <R>(
    obligation: FakeObligation,
    body: (handle: WorkflowHandle<typeof filingObligation>) => Promise<R>,
  ) => runWorkflow(env, obligation, body);

  it('S10: a biennial created in June turns due 1 Nov, is reminded 1/17/24 Dec with jitter, overdue 1 Jan; jitter equal across runs', async () => {
    await env.skipTime({ until: nairobi('2027-06-01', '12:00') });
    const first = await playBiennialCycle(env);

    expect(first.statuses.map((s) => s.status)).toEqual(['due', 'overdue']);
    expectAround(first.statuses[0]?.at, nairobi('2027-11-01'));
    expectAround(first.statuses[1]?.at, nairobi('2028-01-01'));
    expect(first.reminders.map((r) => r.request)).toEqual([
      {
        obligationId: BIENNIAL_ID,
        offsetDays: 30,
        scheduledAt: reminderSlot(BIENNIAL_ID, '2027-12-01'),
      },
      {
        obligationId: BIENNIAL_ID,
        offsetDays: 14,
        scheduledAt: reminderSlot(BIENNIAL_ID, '2027-12-17'),
      },
      {
        obligationId: BIENNIAL_ID,
        offsetDays: 7,
        scheduledAt: reminderSlot(BIENNIAL_ID, '2027-12-24'),
      },
    ]);
    for (const reminder of first.reminders) {
      expectAround(reminder.at, new Date(reminder.request.scheduledAt));
    }
    expect(first.skipped).toEqual([]);

    // A second run for the same obligation, on another server started at another time of day,
    // picks the same instants.
    const other = await WorkflowTestEnvironment.create();
    try {
      await other.skipTime({ until: nairobi('2027-07-15', '17:45') });
      const second = await playBiennialCycle(other);
      expect(second.reminders.map((r) => r.request)).toEqual(first.reminders.map((r) => r.request));
    } finally {
      await other.teardown();
    }
  }, 120_000);

  it('S11: skips the reminder of a declarant not onboarded, then sends the next after personLinked', async () => {
    await env.skipTime({ until: nairobi('2028-03-10', '05:00') });
    const obligation = initial(env, INITIAL_ID, '2028-03-10');

    await run(obligation, async (handle) => {
      // Reminders on 10 Mar (30 days before), 26 Mar (14) and 2 Apr (7).
      await env.skipTime({ until: nairobi('2028-03-20') });
      expect(obligation.reminders.map((r) => r.result)).toEqual(['skipped-not-onboarded']);

      obligation.personId = 'person-1';
      await handle.signal(personLinkedSignal);
      expect(await handle.query(stateQuery)).toMatchObject({ personLinked: true });

      await env.skipTime({ until: nairobi('2028-03-27') });
      expect(obligation.reminders.map((r) => [r.request.offsetDays, r.result])).toEqual([
        [30, 'skipped-not-onboarded'],
        [14, 'sent'],
      ]);
      expect(await handle.query(stateQuery)).toMatchObject({
        remindersRecorded: [30, 14],
        next: { kind: 'reminder', offsetDays: 7, at: reminderSlot(INITIAL_ID, '2028-04-02') },
      });
      await handle.signal(filedSignal);
      await expect(handle.result()).resolves.toBe('filed');
    });

    // An initial is due from creation: no status change until it is filed.
    expect(obligation.statuses).toEqual([]);
  }, 60_000);

  it('S12: cancel ends the workflow; no further reminders or status changes', async () => {
    const id = '0199a000-0000-7000-8000-00000000b011';
    await env.skipTime({ until: nairobi('2029-06-02') });
    const obligation = biennial(env, id, 2029);

    await run(obligation, async (handle) => {
      await env.skipTime({ until: nairobi('2029-12-05') });
      expect(obligation.sentOffsets()).toEqual([30]);

      await handle.signal(cancelSignal, 'exited-before-statement-date');
      await expect(handle.result()).resolves.toBe('cancelled');
      await env.skipTime({ until: nairobi('2030-01-02') });
    });

    expect(obligation.sentOffsets()).toEqual([30]);
    expect(obligation.statuses.map((s) => s.status)).toEqual(['due']);
  }, 60_000);

  it('records reminders whose day passed before the workflow started as skipped, and sends the rest', async () => {
    const id = '0199a000-0000-7000-8000-00000000a012';
    // Started late (by the sweep) on 28 Mar 2031: the 10 and 26 Mar reminders are past.
    await env.skipTime({ until: nairobi('2031-03-28') });
    const obligation = initial(env, id, '2031-03-10');
    obligation.row.recordedOffsets = [30];
    obligation.personId = 'person-1';

    await run(obligation, async (handle) => {
      await env.skipTime({ until: nairobi('2031-04-11') });
      await handle.signal(cancelSignal, 'superseded');
      await handle.result();
    });

    // 30 was recorded at creation; 14 is recorded now; 7 is sent on its day.
    expect(obligation.skipped).toEqual([
      { offsetDays: 14, scheduledAt: reminderSlot(id, '2031-03-26') },
    ]);
    expect(obligation.sentOffsets()).toEqual([7]);
    expect(obligation.statuses.map((s) => s.status)).toEqual(['overdue']);
  }, 60_000);

  it('retries a reminder that failed to send, and moves on when every attempt fails', async () => {
    const id = '0199a000-0000-7000-8000-00000000a013';
    await env.skipTime({ until: nairobi('2032-03-10', '05:00') });
    const obligation = initial(env, id, '2032-03-10');
    obligation.row.reminderOffsetsDays = [30, 7];
    obligation.personId = 'person-1';
    obligation.failReminders = 2;

    await run(obligation, async (handle) => {
      await env.skipTime({ until: nairobi('2032-03-12') });
      expect(obligation.attempts).toBe(3);
      expect(obligation.sentOffsets()).toEqual([30]);

      obligation.failReminders = Number.POSITIVE_INFINITY;
      await env.skipTime({ until: nairobi('2032-04-11') });
      await handle.signal(cancelSignal, 'superseded');
      await handle.result();
    });

    expect(obligation.attempts).toBe(6);
    expect(obligation.sentOffsets()).toEqual([30]);
    // The timeline goes on: the obligation still turned overdue.
    expect(obligation.statuses.map((s) => s.status)).toEqual(['overdue']);
  }, 60_000);

  it('ends at once for an obligation already cancelled or unknown', async () => {
    const cancelled = biennial(env, '0199a000-0000-7000-8000-00000000b012');
    cancelled.row.status = 'cancelled';
    const activities = cancelled.activities();

    await expect(
      env.execute(filingObligation, {
        workflowsPath,
        activities,
        args: [{ obligationId: cancelled.row.obligationId }],
      }),
    ).resolves.toBe('cancelled');
    await expect(
      env.execute(filingObligation, {
        workflowsPath,
        activities: { ...activities, loadObligation: () => Promise.resolve(null) },
        args: [{ obligationId: '0199a000-0000-7000-8000-00000000ffff' }],
      }),
    ).resolves.toBe('missing');
    expect(activities.setStatus).not.toHaveBeenCalled();
  }, 60_000);
});
