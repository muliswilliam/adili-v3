/**
 * Workflows hosted by the declarations worker (ADR-003). This module is bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow`, types and pure modules.
 */
import { ActivityFailure, condition, log, proxyActivities, setHandler } from '@temporalio/workflow';

import type { ObligationStatus } from '../engine.js';
import type { ObligationActivities } from './activities.js';
import {
  cancelSignal,
  datesChangedSignal,
  type FilingObligationEnd,
  type FilingObligationInput,
  type FilingObligationState,
  filedSignal,
  personLinkedSignal,
  REMINDER_ATTEMPTS,
  stateQuery,
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

/**
 * `FilingObligationWorkflow` (spec 04), one per filing obligation with the obligation id as
 * workflow id: turns the obligation due at its statement date, sends each reminder at its offset
 * before the due date (jittered per obligation), turns it overdue after the due date, then waits
 * for signals. Status and reminders are written by activities; the workflow keeps no state the
 * database lacks. `datesChanged` re-plans the timers; `cancel` and `filed` end it.
 */
export async function filingObligation({
  obligationId,
}: FilingObligationInput): Promise<FilingObligationEnd> {
  const signals: { ended: FilingObligationEnd | null; replan: boolean } = {
    ended: null,
    replan: false,
  };
  const state: FilingObligationState = {
    obligationId,
    status: null,
    statementDate: null,
    dueDate: null,
    personLinked: false,
    remindersRecorded: [],
    next: null,
  };
  let schedule: ObligationSchedule | undefined;
  setHandler(personLinkedSignal, () => {
    state.personLinked = true;
  });
  setHandler(datesChangedSignal, ({ statementDate, dueDate }) => {
    if (schedule) schedule = { ...schedule, statementDate, dueDate };
    state.statementDate = statementDate;
    state.dueDate = dueDate;
    signals.replan = true;
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
  schedule = {
    obligationId,
    type: loaded.type,
    // A `datesChanged` that arrived while loading wins over what was read.
    statementDate: state.statementDate ?? loaded.statementDate,
    dueDate: state.dueDate ?? loaded.dueDate,
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

  /** Waits until `at`; true when a signal cut the wait short (end or re-plan). */
  const until = async (at: number): Promise<boolean> => {
    const interrupted = () => signals.ended !== null || signals.replan;
    const ms = at - Date.now();
    return ms > 0 ? condition(interrupted, ms) : interrupted();
  };
  /** Moves the status on; the end of the workflow when it had become terminal meanwhile. */
  const changeStatus = async (to: ObligationStatus): Promise<FilingObligationEnd | null> => {
    const status = await setStatus(obligationId, to);
    state.status = status;
    return endOf(status);
  };

  for (;;) {
    signals.replan = false;
    const plan = timeline(schedule, Date.now(), recorded);
    if (plan.missed.length > 0) {
      await recordSkippedReminders(
        obligationId,
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
      const interrupted = await until(step.at);
      if (signals.ended) return signals.ended;
      if (interrupted) break;
      if (step.kind === 'status') {
        const end = await changeStatus(step.status);
        if (end) return end;
        continue;
      }
      try {
        const outcome = await sendReminder({
          obligationId,
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

    // Set by a signal during the awaits above (a read TS would otherwise narrow to false).
    if (!replanRequested(signals)) {
      state.next = null;
      await condition(() => signals.ended !== null || signals.replan);
      if (signals.ended) return signals.ended;
    }
  }
}

/**
 * The hourly reconciliation sweep (started by the sweep schedule, `sweepScheduleId`): starts the
 * workflow of every open obligation that has none. Returns how many it started.
 */
export async function obligationsSweep(): Promise<number> {
  return sweepObligations();
}

function replanRequested(signals: { replan: boolean }): boolean {
  return signals.replan;
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
