import type { ConfirmOutcome } from '../../server/form-m-sign-off.server';

/**
 * The commission-admin's "Confirm and submit" (spec 09 FE-2, S6) as a pure state machine, as
 * spec 06's submit flow runs it in the portal: the button sends them to confirm their identity
 * with a one-time code (step-up), the return opens the confirm dialog with a fresh
 * Idempotency-Key, and the service's answer moves on to the submitted report or back to what
 * they can do about it. The view (`sign-off.tsx`) dispatches events and runs the effects each
 * state asks for (leaving for the step-up, reloading).
 */

/** Why the service did not take the confirmation, shown as a banner over the report. */
export type ConfirmRefusal =
  'not-reviewed' | 'incomplete' | 'already-submitted' | 'compiling' | 'forbidden';

export type ConfirmState =
  /** The report; "Confirm and submit" is enabled once it is reviewed and Part I and B filled. */
  | { step: 'idle' }
  /** Leaving for `/auth/step-up`; the BFF sends them back with `stepUp=done|failed`. */
  | { step: 'stepping-up' }
  /** The step-up failed or expired (`stepUp=failed`, or 403 `step-up-required`). */
  | { step: 'step-up-failed' }
  /**
   * The confirm dialog. `key` is the Idempotency-Key of this dialog: kept on retry, dropped when
   * it closes. `failed`: the last submit did not go through (nothing was sent twice).
   */
  | { step: 'confirm'; key: string; checked: boolean; failed: boolean }
  /** The confirmation is in flight; the dialog cannot be closed. */
  | { step: 'submitting'; key: string }
  /** The service refused it: the dialog closed and the report reloads with a banner. */
  | { step: 'refused'; reason: ConfirmRefusal; paths?: readonly string[] }
  /** The session ended: sign in again. */
  | { step: 'signed-out' }
  /** Submitted: the report reloads as submitted. */
  | { step: 'submitted' };

export type ConfirmEvent =
  /** "Confirm and submit" in the footer, or "Confirm identity" after a failed step-up. */
  | { type: 'confirm-pressed' }
  /** Back from the step-up; `key` is a new Idempotency-Key for the dialog it opens. */
  | { type: 'step-up-returned'; confirmed: boolean; key: string }
  | { type: 'checked'; checked: boolean }
  /** "Confirm and submit" (or "Try again") in the dialog. */
  | { type: 'submit-pressed' }
  | { type: 'answered'; answer: ConfirmOutcome }
  /** Cancel, Esc or the close button. */
  | { type: 'dialog-closed' };

export const initialConfirmState: ConfirmState = { step: 'idle' };

export function confirmReducer(state: ConfirmState, event: ConfirmEvent): ConfirmState {
  switch (event.type) {
    case 'confirm-pressed':
      return state.step === 'idle' || state.step === 'step-up-failed' || state.step === 'refused'
        ? { step: 'stepping-up' }
        : state;
    case 'step-up-returned':
      if (state.step !== 'idle' && state.step !== 'stepping-up') return state;
      return event.confirmed
        ? { step: 'confirm', key: event.key, checked: false, failed: false }
        : { step: 'step-up-failed' };
    case 'checked':
      return state.step === 'confirm' ? { ...state, checked: event.checked } : state;
    case 'submit-pressed':
      return state.step === 'confirm' && state.checked
        ? { step: 'submitting', key: state.key }
        : state;
    case 'answered':
      return state.step === 'submitting' ? answered(state.key, event.answer) : state;
    case 'dialog-closed':
      return state.step === 'confirm' ? initialConfirmState : state;
  }
}

function answered(key: string, answer: ConfirmOutcome): ConfirmState {
  switch (answer.status) {
    case 'submitted':
      return { step: 'submitted' };
    case 'step-up-required':
      return { step: 'step-up-failed' };
    case 'unauthenticated':
      return { step: 'signed-out' };
    case 'incomplete':
      return { step: 'refused', reason: 'incomplete', paths: answer.paths };
    // Not the commission-admin any more (a role changed meanwhile) is as final as the others.
    case 'not-reviewed':
    case 'already-submitted':
    case 'compiling':
    case 'forbidden':
      return { step: 'refused', reason: answer.status };
    // No answer: say it did not go through, and keep the key for another try.
    case 'unavailable':
      return { step: 'confirm', key, checked: true, failed: true };
  }
}

/** Whether the confirm dialog is open in this state. */
export function dialogOpen(
  state: ConfirmState,
): state is Extract<ConfirmState, { step: 'confirm' | 'submitting' }> {
  return state.step === 'confirm' || state.step === 'submitting';
}

/** What the step-up return marker (`?stepUp=`) says, if the page was opened with one. */
export type StepUpMarker = 'done' | 'failed';
