/**
 * Workflows hosted by the declarations worker (ADR-003). This module is bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow`, types and pure modules.
 */
import {
  ActivityFailure,
  condition,
  continueAsNew,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

import type { ObligationStatus, OpenStatus } from '../engine.js';
import type { ObligationActivities } from './activities.js';
import type { CycleOpeningActivities } from './cycle-opening-activities.js';
import {
  cancelSignal,
  CYCLE_OPENING_PAGES_PER_RUN,
  type CycleOpened,
  type CycleOpeningInput,
  type FilingObligationEnd,
  type FilingObligationInput,
  type FilingObligationState,
  filedSignal,
  personLinkedSignal,
  REMINDER_ATTEMPTS,
  stateQuery,
  type SweepResult,
} from './contract.js';
import { type ObligationSchedule, timeline, type TimelineStep } from './timeline.js';

// Database work: retried until it succeeds, so a status change is late at worst, never lost.
const { loadObligation, setStatus, recordSkippedReminders } = proxyActivities<ObligationActivities>(
  {
    startToCloseTimeout: '30 seconds',
    retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
  },
);

// A provider failure is retried (spaced out so a directory or gateway outage can pass); the last
// attempt records what was sent, or `failed`, instead of throwing.
const { sendReminder } = proxyActivities<ObligationActivities>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: REMINDER_ATTEMPTS,
    initialInterval: '5 minutes',
    backoffCoefficient: 3,
  },
});

const { sweepObligations } = proxyActivities<ObligationActivities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '2 minutes',
  retry: { maximumAttempts: 3 },
});

// A page is one transaction of up to 1,000 creates plus their workflow starts, heartbeating
// throughout; retried until done (a later firing of the schedule would resume it anyway, from the
// first page, creating nothing twice).
const { cyclesToOpen, openCyclePage, recordCycleOpened } = proxyActivities<CycleOpeningActivities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '2 minutes',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

/**
 * `FilingObligationWorkflow` (spec 04), one per filing obligation with the obligation id as
 * workflow id: turns the obligation due at its statement date, sends each reminder at its offset
 * before the due date (jittered per obligation), turns it overdue after the due date, then waits
 * for signals. Status and reminders are written by activities; the workflow keeps no state the
 * database lacks. `cancel` and `filed` end it.
 *
 * An obligation's dates never change: a corrected appointment or exit date supersedes it (a new
 * obligation with its own workflow, the old one cancelled), so there is no re-planning signal.
 *
 * It does not continue as new (ADR-003 §5): its history is bounded whatever the obligation's
 * life (one load, at most three status changes, one activity per reminder offset, a few
 * signals), a few dozen events. The escalation ladder (spec 08) is where that changes.
 */
export async function filingObligation({
  obligationId,
}: FilingObligationInput): Promise<FilingObligationEnd> {
  const signals: { ended: FilingObligationEnd | null } = { ended: null };
  const state: FilingObligationState = {
    obligationId,
    status: null,
    statementDate: null,
    dueDate: null,
    personLinked: false,
    remindersRecorded: [],
    next: null,
  };
  setHandler(personLinkedSignal, () => {
    state.personLinked = true;
  });
  setHandler(cancelSignal, () => {
    signals.ended = 'cancelled';
  });
  setHandler(filedSignal, () => {
    signals.ended = 'filed';
  });
  setHandler(stateQuery, () => ({ ...state, remindersRecorded: [...state.remindersRecorded] }));

  const loaded = await loadObligation(obligationId);
  if (!loaded) return 'missing';
  const terminal = endOf(loaded.status);
  if (terminal) return terminal;
  const ref = { obligationId, tenant: loaded.tenant };
  const schedule: ObligationSchedule = {
    obligationId,
    type: loaded.type,
    statementDate: loaded.statementDate,
    dueDate: loaded.dueDate,
    reminderOffsetsDays: loaded.reminderOffsetsDays,
    jitterWindowMs: loaded.jitterWindowMs,
  };
  Object.assign(state, {
    status: loaded.status,
    statementDate: schedule.statementDate,
    dueDate: schedule.dueDate,
    personLinked: state.personLinked || loaded.personLinked,
  });
  const recorded = new Set(loaded.recordedOffsets);
  const record = (offsetDays: number) => {
    recorded.add(offsetDays);
    state.remindersRecorded = [...recorded].sort((a, b) => b - a);
  };
  state.remindersRecorded = [...recorded].sort((a, b) => b - a);

  /** Waits until `at`, or until a signal ends the workflow. */
  const until = async (at: number): Promise<void> => {
    const ms = at - Date.now();
    if (ms > 0) await condition(() => signals.ended !== null, ms);
  };
  /** Moves the status on; the end of the workflow when it had become terminal meanwhile. */
  const changeStatus = async (to: OpenStatus): Promise<FilingObligationEnd | null> => {
    const status = await setStatus(ref, to);
    state.status = status;
    return endOf(status);
  };

  const plan = timeline(schedule, Date.now(), recorded);
  if (plan.missed.length > 0) {
    await recordSkippedReminders(
      ref,
      plan.missed.map(({ offsetDays, scheduledAt }) => ({
        offsetDays,
        scheduledAt: new Date(scheduledAt).toISOString(),
      })),
    );
    for (const { offsetDays } of plan.missed) record(offsetDays);
  }
  if (plan.status !== state.status) {
    const end = await changeStatus(plan.status);
    if (end) return end;
  }

  for (const step of plan.steps) {
    state.next = nextOf(step);
    await until(step.at);
    if (signals.ended) return signals.ended;
    if (step.kind === 'status') {
      const end = await changeStatus(step.status);
      if (end) return end;
      continue;
    }
    try {
      const outcome = await sendReminder({
        ...ref,
        offsetDays: step.offsetDays,
        scheduledAt: new Date(step.at).toISOString(),
      });
      if (outcome !== 'not-open') record(step.offsetDays);
    } catch (error) {
      if (!(error instanceof ActivityFailure)) throw error;
      // Not even the last attempt could record an outcome (database down): move on.
      log.warn('Reminder not recorded', { obligationId, offsetDays: step.offsetDays });
    }
  }

  state.next = null;
  await condition(() => signals.ended !== null);
  return signals.ended ?? 'cancelled';
}

/**
 * The hourly reconciliation sweep (started by the sweep schedule, `sweepScheduleId`): starts the
 * workflow of every open obligation that has none running (never started, or its run stopped
 * short), and cancels the upcoming obligations exited declarants no longer owe. Returns how many
 * of each.
 */
export async function obligationsSweep(): Promise<SweepResult> {
  return sweepObligations();
}

/**
 * `CycleOpeningWorkflow` (spec 04), started by the Commission's cycle-opening schedule
 * (`cycleOpeningScheduleId`): opens every cycle the calendar has opened by today that was not
 * opened for the Commission yet, creating its biennial obligations for the active declarants page
 * by page, then records it opened (`obligation.cycle.opened.v1`). Continues as new every 100
 * pages to keep histories short. Returns the cycles this run finished opening; a firing with nothing to
 * open returns none.
 */
export async function cycleOpening({ tenant, resume }: CycleOpeningInput): Promise<CycleOpened[]> {
  const cycleYears = resume?.cycleYears ?? (await cyclesToOpen(tenant));
  let cursor = resume?.cursor ?? null;
  let pages = 0;
  const opened: CycleOpened[] = [];
  for (const [index, cycleYear] of cycleYears.entries()) {
    for (;;) {
      if (pages === CYCLE_OPENING_PAGES_PER_RUN) {
        return continueAsNew<typeof cycleOpening>({
          tenant,
          resume: { cycleYears: cycleYears.slice(index), cursor },
        });
      }
      const page = await openCyclePage({ tenant, cycleYear, cursor });
      pages += 1;
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    opened.push(await recordCycleOpened(tenant, cycleYear));
    cursor = null;
  }
  return opened;
}

function endOf(status: ObligationStatus): FilingObligationEnd | null {
  return status === 'cancelled' || status === 'filed' ? status : null;
}

function nextOf(step: TimelineStep): FilingObligationState['next'] {
  const at = new Date(step.at).toISOString();
  return step.kind === 'status'
    ? { kind: step.status, at }
    : { kind: 'reminder', offsetDays: step.offsetDays, at };
}
