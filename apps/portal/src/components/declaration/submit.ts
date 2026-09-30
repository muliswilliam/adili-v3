import { formatDate } from '@adili/ui';

import type { CompletenessIssue } from '../../server/declarations/types';
import type { SubmitConflict, SubmitOutcome } from '../../server/submission.server';
import type { Unauthenticated } from '../../server/results';

/**
 * The summary's submit flow (spec 06 FE-2, S19) as a pure state machine: Submit sends the
 * declarant to confirm their identity with a one-time code (step-up), the return opens the
 * affirmation dialog with a fresh Idempotency-Key, and the service's answer moves on to the
 * success page or back to what the declarant can do about it. The view (`submit-flow.tsx`)
 * dispatches events and runs the effects each state asks for (navigating, reloading).
 */

/** What the dialog shows under the checkbox after a submit that did not file. */
export type SubmitProblem = SubmitConflict | 'error';

export type SubmitState =
  /** The summary; Submit is enabled when the summary says `canSubmit`. */
  | { step: 'idle' }
  /** Leaving for `/auth/step-up`; the BFF sends the declarant back with `stepUp=done|failed`. */
  | { step: 'stepping-up' }
  /** The step-up failed or expired (`stepUp=failed`, or 403 `step-up-required`). */
  | { step: 'step-up-failed' }
  /**
   * The affirmation dialog. `key` is the Idempotency-Key of this dialog instance: kept on retry,
   * dropped when the dialog closes.
   */
  | { step: 'affirm'; key: string; affirmed: boolean; problem: SubmitProblem | null }
  /** The submit is in flight; the dialog cannot be closed. */
  | { step: 'submitting'; key: string }
  /** 400: the dialog closed and the summary shows what blocks submission. */
  | { step: 'incomplete'; blocking: CompletenessIssue[] }
  /** The session ended while submitting: sign in again. */
  | { step: 'signed-out' }
  /** 201: on to the success page. */
  | { step: 'submitted' };

export type SubmitAnswer = SubmitOutcome | Unauthenticated;

export type SubmitEvent =
  /** Submit on the summary, or "Confirm identity" after a failed step-up. */
  | { type: 'submit-pressed' }
  /** Back from the step-up; `key` is a new Idempotency-Key for the dialog it opens. */
  | { type: 'step-up-returned'; confirmed: boolean; key: string }
  | { type: 'affirm-changed'; affirmed: boolean }
  /** "Submit declaration" in the dialog. */
  | { type: 'confirmed' }
  | { type: 'answered'; answer: SubmitAnswer }
  /** Cancel, Esc or the close button. */
  | { type: 'dialog-closed' };

export const initialSubmitState: SubmitState = { step: 'idle' };

/** Whether a dialog problem can go away by submitting again with the same key. */
function retryable(problem: SubmitProblem | null) {
  return problem === null || problem === 'error';
}

export function submitReducer(state: SubmitState, event: SubmitEvent): SubmitState {
  switch (event.type) {
    case 'submit-pressed':
      return state.step === 'idle' || state.step === 'step-up-failed' || state.step === 'incomplete'
        ? { step: 'stepping-up' }
        : state;
    case 'step-up-returned':
      if (state.step !== 'idle' && state.step !== 'stepping-up') return state;
      return event.confirmed
        ? { step: 'affirm', key: event.key, affirmed: false, problem: null }
        : { step: 'step-up-failed' };
    case 'affirm-changed':
      return state.step === 'affirm' ? { ...state, affirmed: event.affirmed } : state;
    case 'confirmed':
      return state.step === 'affirm' && state.affirmed && retryable(state.problem)
        ? { step: 'submitting', key: state.key }
        : state;
    case 'answered':
      return state.step === 'submitting' ? answered(state.key, event.answer) : state;
    case 'dialog-closed':
      return state.step === 'affirm' ? initialSubmitState : state;
  }
}

function answered(key: string, answer: SubmitAnswer): SubmitState {
  switch (answer.status) {
    case 'submitted':
      return { step: 'submitted' };
    case 'step-up-required':
      return { step: 'step-up-failed' };
    case 'incomplete':
      return { step: 'incomplete', blocking: answer.blocking };
    case 'conflict':
      return { step: 'affirm', key, affirmed: true, problem: answer.code };
    // Gone since the summary loaded: as good as changed elsewhere.
    case 'not-found':
      return { step: 'affirm', key, affirmed: true, problem: 'not-a-draft' };
    case 'unauthenticated':
      return { step: 'signed-out' };
    case 'unavailable':
      return { step: 'affirm', key, affirmed: true, problem: 'error' };
  }
}

/** Whether the affirmation dialog is open in this state. */
export function dialogOpen(
  state: SubmitState,
): state is Extract<SubmitState, { step: 'affirm' | 'submitting' }> {
  return state.step === 'affirm' || state.step === 'submitting';
}

/** What the step-up return marker (`?stepUp=`) says, if the summary was opened with one. */
export type StepUpMarker = 'done' | 'failed';

/**
 * Whether the declarant came back from a step-up that went through: the BFF said `done` and the
 * session holds a fresh step-up. The service checks the token again on submit.
 */
export function stepUpConfirmed(marker: StepUpMarker, fresh: boolean): boolean {
  return marker === 'done' && fresh;
}

/** Copy of the submit flow (spec 06 FE comment "Portal: Submit flow"). */
export const SUBMIT_COPY = {
  stepUpFailed: 'We could not confirm your identity. Try again.',
  confirmIdentity: 'Confirm identity',
  dialogTitle: 'Submit your declaration',
  identityConfirmed: (time: string) => `Identity confirmed at ${time}`,
  late: (dueDate: string) =>
    `This declaration is being submitted after its due date (${formatDate(dueDate)}). It will be recorded as filed late.`,
  solemn: 'Solemn declaration',
  affirm: 'I affirm that this declaration is true and complete to the best of my knowledge',
  affirmHint: 'Giving false information is an offence.',
  noSignature: 'You affirm this when you submit. No signature or witness needed.',
  submit: 'Submit declaration',
  submitting: 'Submitting…',
  cancel: 'Cancel',
  reload: 'Reload',
} as const;

/** The dialog's message for a problem; conflict copy names the dates it is about. */
export function problemMessage(
  problem: SubmitProblem,
  dates: { statementDate: string; dueDate: string | null },
): string {
  switch (problem) {
    case 'error':
      return 'Your declaration was not submitted. Try again.';
    case 'before-statement-date':
      return `You can submit from ${formatDate(dates.statementDate)}.`;
    case 'amendment-window-closed':
      return dates.dueDate
        ? `Amendments closed on ${formatDate(dates.dueDate)}. Contact your Commission.`
        : 'Amendments are closed. Contact your Commission.';
    case 'not-a-draft':
      return 'This declaration changed in another window. Reload to see its current state.';
    case 'obligation-cancelled':
      return 'This declaration is no longer required, so it cannot be submitted. Contact your Commission if you think this is wrong.';
  }
}
