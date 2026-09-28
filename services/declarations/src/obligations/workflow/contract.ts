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
  /** The Commission's reminder offsets, days before the due date. */
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
/** The obligation's dates changed in the database: re-plan every timer. */
export const datesChangedSignal =
  defineSignal<[{ statementDate: CivilDate; dueDate: CivilDate }]>('datesChanged');
/** The obligation was cancelled in the database: the workflow ends. */
export const cancelSignal = defineSignal<[CancelReason]>('cancel');
/** A declaration filed the obligation (slice 06): the workflow ends. */
export const filedSignal = defineSignal('filed');

export const stateQuery = defineQuery<FilingObligationState>('state');
