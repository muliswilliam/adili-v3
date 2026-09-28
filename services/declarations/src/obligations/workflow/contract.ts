/**
 * What passes between the obligation workflows, their activities and the service that starts and
 * signals them. Bundled into the workflow sandbox: types and `@temporalio/workflow` definitions
 * only.
 */
import { defineQuery, defineSignal } from '@temporalio/workflow';

import type { CivilDate } from '../dates.js';
import type { CancelReason, ObligationStatus, ObligationType } from '../engine.js';
import type { ReminderOutcome } from '../schema.js';

/** Workflow type names, for starting by name (the worker bundles the code, not the caller). */
export const FILING_OBLIGATION_WORKFLOW = 'filingObligation';
export const OBLIGATIONS_SWEEP_WORKFLOW = 'obligationsSweep';
export const CYCLE_OPENING_WORKFLOW = 'cycleOpening';

/** Attempts of `sendReminder`; the last one records the outcome instead of failing. */
export const REMINDER_ATTEMPTS = 3;

export interface FilingObligationInput {
  obligationId: string;
}

/** The obligation as its workflow needs it, read by `loadObligation`. */
export interface LoadedObligation {
  obligationId: string;
  tenant: string;
  type: ObligationType;
  statementDate: CivilDate;
  dueDate: CivilDate;
  status: ObligationStatus;
  /** Whether the declarant has onboarded (a person is linked). */
  personLinked: boolean;
  /** The reminder offsets of the obligation's policy version, days before the due date. */
  reminderOffsetsDays: number[];
  /** Offsets that already have a reminder row (sent, skipped or failed). */
  recordedOffsets: number[];
  /** Platform configuration: reminders are spread this much either way. */
  jitterWindowMs: number;
}

export interface ReminderRequest {
  obligationId: string;
  offsetDays: number;
  /** The reminder's planned instant (ISO), jitter included. */
  scheduledAt: string;
}

/** What became of a reminder; `not-open` when the obligation no longer takes reminders (no row). */
export type SendReminderResult = ReminderOutcome | 'not-open';

/** What a run of the reconciliation sweep did. */
export interface SweepResult {
  /** Workflows started for open obligations that had none. */
  started: number;
  /** Upcoming obligations of exited declarants cancelled. */
  cancelled: number;
}

/** Why a workflow ended. */
export type FilingObligationEnd = 'cancelled' | 'filed' | 'missing';

/** The `state` query: for tests and operators. */
export interface FilingObligationState {
  obligationId: string;
  status: ObligationStatus | null;
  statementDate: CivilDate | null;
  dueDate: CivilDate | null;
  personLinked: boolean;
  /** Offsets with a recorded outcome, earliest reminder first. */
  remindersRecorded: number[];
  /** The next timer: what it does and when (ISO); null while waiting for signals only. */
  next: { kind: 'due' | 'overdue' | 'reminder'; offsetDays?: number; at: string } | null;
}

/** The declarant onboarded: reminders from now on are sent (the activity reads the person). */
export const personLinkedSignal = defineSignal('personLinked');
/** The obligation was cancelled in the database: the workflow ends. */
export const cancelSignal = defineSignal<[CancelReason]>('cancel');
/** A declaration filed the obligation (slice 06): the workflow ends. */
export const filedSignal = defineSignal('filed');

/**
 * `CycleOpeningWorkflow` for one Commission, started by its schedule with the tenant only. The
 * rest is set when a run continues as new mid-opening.
 */
export interface CycleOpeningInput {
  tenant: string;
  resume?: {
    /** The cycles still to open, the first one in progress. */
    cycleYears: number[];
    /** Where the cycle in progress stopped (the last roster record id of the page before). */
    cursor: string | null;
    /** Obligations created for it so far. */
    created: number;
  };
}

/** Pages a run of `CycleOpeningWorkflow` opens before it continues as new (short histories). */
export const CYCLE_OPENING_PAGES_PER_RUN = 100;

/** One page of a Commission's active roster snapshots to open a cycle for. */
export interface CycleOpeningPageRequest {
  tenant: string;
  cycleYear: number;
  /** The last roster record id of the previous page; null for the first. */
  cursor: string | null;
}

export interface CycleOpeningPage {
  /** Biennial obligations the page created. */
  created: number;
  /** The cursor of the next page; null after the last. */
  nextCursor: string | null;
}

/** A cycle opened for a Commission, and how many obligations the opening created. */
export interface CycleOpened {
  cycleYear: number;
  count: number;
}

export const stateQuery = defineQuery<FilingObligationState>('state');
