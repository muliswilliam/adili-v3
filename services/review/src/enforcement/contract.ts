/**
 * What passes between `EnforcementWorkflow`, its activities, the consumers that start and signal
 * it and the endpoints that decide its steps. Bundled into the workflow sandbox: types and
 * constants only.
 *
 * Identifiers, steps, states and instants only: the activities read the ladder and its actions
 * where they use them, so no names, references, notes, responses or letter text enter Temporal's
 * history.
 */
import type { ActionStep, ClosingCause, SubjectKind } from './schema.js';

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const ENFORCEMENT_WORKFLOW = 'enforcement';

/** One workflow per subject: an overdue obligation or an unanswered clarification. */
export function enforcementWorkflowId(subjectKind: SubjectKind, subjectId: string): string {
  return `enforcement:${subjectKind}:${subjectId}`;
}

/**
 * The steps `EnforcementWorkflow` drafts, in order. After the disciplinary referral the ladder
 * waits for compliance.
 */
export const LADDER_STEPS = [
  'notice-to-comply',
  'warning',
  'salary-stoppage',
  'disciplinary-referral',
] as const satisfies readonly ActionStep[];
export type LadderStep = (typeof LADDER_STEPS)[number];

/** The subject the ladder is about, from the event that started it. */
export interface EnforcementInput {
  tenant: string;
  subjectKind: SubjectKind;
  subjectId: string;
  /** A restart after a decline: the step to draft again. Absent for a first start. */
  restartAt?: LadderStep;
}

/**
 * What `openLadder` found: the ladder to run (new, or restarted), or why there is none to run:
 * the subject is `not-owed` (no longer overdue or unanswered; the cause says why, when it closed
 * the ladder), `missing`, or its ladder `closed` already (declined, complied or ended; a repeated
 * overdue event restarts nothing).
 */
export type OpenedLadder =
  | { outcome: 'opened'; ladderId: string }
  | { outcome: 'not-owed'; cause: ClosingCause | null }
  | { outcome: 'missing' }
  | { outcome: 'closed' };

export interface LadderRef {
  tenant: string;
  ladderId: string;
}

export interface StepRequest extends LadderRef {
  step: LadderStep;
}

export interface ActionRef {
  tenant: string;
  actionId: string;
}

/**
 * Where an action stands for the workflow: still `proposed`, `approved` (issue it), `declined`
 * (the ladder ends), or `closed` (complied or cancelled: nothing more to do).
 */
export type ActionDecision = 'proposed' | 'approved' | 'declined' | 'closed';

/** What `issueLetter` did: asked documents for the letter, or found it already asked for. */
export type ActionLetterOutcome = 'requested' | 'already-requested';

/** notifications.yaml `Channel`, in the order the declarant is told. */
export const ACTION_CHANNELS = ['email', 'sms'] as const;
export type ActionChannel = (typeof ACTION_CHANNELS)[number];

export interface ActionNotice extends ActionRef {
  channel: ActionChannel;
  /** The salary reinstated after a stoppage, rather than the step issued. */
  reinstatement?: boolean;
}

/**
 * What became of one message: handed to the provider, `failed` there, `rejected` by
 * notifications, or `skipped`: an officer who never onboarded has no person to message.
 */
export type ActionNoticeOutcome = 'sent' | 'failed' | 'rejected' | 'skipped';

/**
 * When the issued step's window ends (ISO 8601), set when its letter was requested; null for the
 * disciplinary referral, after which the ladder waits for compliance with no deadline.
 */
export interface IssuedAction {
  windowEndsAt: string | null;
}

/**
 * What `stopSalary` did: payroll acknowledged the stop (now or before), or there is no roster
 * record to stop a salary on (nothing sent; the step waits for compliance, unissued).
 */
export type SalaryStopOutcome = 'stopped' | 'no-roster-record';

/** What `reinstateSalary` did: the stoppage it reinstated, or null when no salary was stopped. */
export interface Reinstatement {
  actionId: string | null;
}

export interface CloseRequest extends LadderRef {
  cause: ClosingCause;
}

/**
 * Signals. `decided`: an officer approved or declined the step waiting for a decision (the
 * workflow reads which). `closed`: the declarant complied or the subject went away, with the
 * cause. Both are sent inside the transaction of the change; the activities read the database
 * before acting, so an early signal only makes the workflow look sooner.
 */
export const DECIDED_SIGNAL = 'decided';
export const CLOSED_SIGNAL = 'closed';

/** How a run ended. */
export type EnforcementResult =
  | { outcome: 'not-owed' | 'missing' | 'closed' }
  | { outcome: 'declined'; step: LadderStep }
  | { outcome: 'complied' | 'ended'; cause: ClosingCause };

/** Closing causes that are compliance (the others end the ladder without it). */
export const COMPLIANCE_CAUSES = [
  'filed',
  'clarification-responded',
  'clarification-resolved',
] as const satisfies readonly ClosingCause[];

export function isCompliance(cause: ClosingCause): boolean {
  return (COMPLIANCE_CAUSES as readonly ClosingCause[]).includes(cause);
}

/** Failure type of a ladder or action that disappeared; not retried. */
export const LADDER_MISSING = 'ladder-missing';

/** Failure type of a payroll instruction the gateway or payroll refused; not retried. */
export const PAYROLL_REFUSED = 'payroll-refused';

/** Failure type of a letter the documents service refused; not retried. */
export const ACTION_LETTER_REFUSED = 'action-letter-refused';
