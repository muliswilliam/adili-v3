import { describe, expect, it } from 'vitest';

import type { SubmissionResult } from '../../server/declarations/types';
import {
  dialogOpen,
  initialSubmitState,
  problemMessage,
  stepUpConfirmed,
  type SubmitAnswer,
  type SubmitEvent,
  submitReducer,
  type SubmitState,
} from './submit';

const KEY = '3f0c9a52-8d4e-4b1a-9c7d-2e6f5a4b3c21';
const OTHER_KEY = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function run(events: SubmitEvent[], from: SubmitState = initialSubmitState): SubmitState {
  return events.reduce(submitReducer, from);
}

const returned = (confirmed = true, key = KEY): SubmitEvent => ({
  type: 'step-up-returned',
  confirmed,
  key,
});
const answered = (answer: SubmitAnswer): SubmitEvent => ({ type: 'answered', answer });
const affirmed: SubmitEvent = { type: 'affirm-changed', affirmed: true };
const confirmed: SubmitEvent = { type: 'confirmed' };

/** In the dialog, ticked, and the submit in flight. */
const inFlight = run([returned(), affirmed, confirmed]);

describe('S19: the submit state machine', () => {
  it('goes to the step-up when Submit is pressed', () => {
    expect(run([{ type: 'submit-pressed' }])).toEqual({ step: 'stepping-up' });
  });

  it('opens the affirmation dialog with a fresh Idempotency-Key when the step-up went through', () => {
    const state = run([{ type: 'submit-pressed' }, returned()]);
    expect(state).toEqual({ step: 'affirm', key: KEY, affirmed: false, problem: null });
    expect(dialogOpen(state)).toBe(true);
  });

  it('says the step-up failed and restarts it from "Confirm identity"', () => {
    const failed = run([returned(false)]);
    expect(failed).toEqual({ step: 'step-up-failed' });
    expect(dialogOpen(failed)).toBe(false);
    expect(run([{ type: 'submit-pressed' }], failed)).toEqual({ step: 'stepping-up' });
  });

  it('reads the return marker as confirmed only with a fresh step-up on the session', () => {
    expect(stepUpConfirmed('done', true)).toBe(true);
    expect(stepUpConfirmed('done', false)).toBe(false);
    expect(stepUpConfirmed('failed', true)).toBe(false);
  });

  it('submits only once "I affirm" is ticked', () => {
    const unticked = run([returned(), confirmed]);
    expect(unticked).toMatchObject({ step: 'affirm', affirmed: false });

    expect(inFlight).toEqual({ step: 'submitting', key: KEY });
    expect(
      run([{ type: 'affirm-changed', affirmed: false }, confirmed], run([returned(), affirmed])),
    ).toMatchObject({ step: 'affirm', affirmed: false });
  });

  it('cannot be closed while submitting', () => {
    expect(run([{ type: 'dialog-closed' }], inFlight)).toBe(inFlight);
    expect(dialogOpen(inFlight)).toBe(true);
  });

  it('moves on to the success page on 201', () => {
    const result = {} as SubmissionResult;
    expect(run([answered({ status: 'submitted', result })], inFlight)).toEqual({
      step: 'submitted',
    });
  });

  it('keeps the same Idempotency-Key when a failed submit is retried', () => {
    const failed = run([answered({ status: 'unavailable' })], inFlight);
    expect(failed).toEqual({ step: 'affirm', key: KEY, affirmed: true, problem: 'error' });
    expect(run([confirmed], failed)).toEqual({ step: 'submitting', key: KEY });
  });

  it('drops the key when the dialog closes and gets a new one when it reopens', () => {
    const closed = run([returned(), { type: 'dialog-closed' }]);
    expect(closed).toEqual({ step: 'idle' });
    const reopened = run([{ type: 'submit-pressed' }, returned(true, OTHER_KEY)], closed);
    expect(reopened).toMatchObject({ step: 'affirm', key: OTHER_KEY });
  });

  it('keeps the dialog open with the reason on a 409, and does not resubmit', () => {
    for (const code of [
      'before-statement-date',
      'amendment-window-closed',
      'not-a-draft',
      'obligation-cancelled',
    ] as const) {
      const conflict = run([answered({ status: 'conflict', code })], inFlight);
      expect(conflict).toEqual({ step: 'affirm', key: KEY, affirmed: true, problem: code });
      expect(run([confirmed], conflict)).toBe(conflict);
    }
  });

  it('reads a declaration gone since the summary loaded as changed elsewhere', () => {
    expect(run([answered({ status: 'not-found' })], inFlight)).toMatchObject({
      problem: 'not-a-draft',
    });
  });

  it('closes the dialog and shows what blocks on a 400', () => {
    const blocking = [
      { sectionKey: 'bio', path: '/officer/birth', code: 'required', message: 'x' },
    ];
    const incomplete = run([answered({ status: 'incomplete', blocking })], inFlight);
    expect(incomplete).toEqual({ step: 'incomplete', blocking });
    expect(dialogOpen(incomplete)).toBe(false);
    expect(run([{ type: 'submit-pressed' }], incomplete)).toEqual({ step: 'stepping-up' });
  });

  it('asks for the step-up again on 403 step-up-required', () => {
    expect(run([answered({ status: 'step-up-required' })], inFlight)).toEqual({
      step: 'step-up-failed',
    });
  });

  it('signs the declarant in again when the session ended', () => {
    expect(run([answered({ status: 'unauthenticated' })], inFlight)).toEqual({
      step: 'signed-out',
    });
  });

  it('ignores events that do not belong to the state', () => {
    expect(run([confirmed])).toBe(initialSubmitState);
    expect(run([answered({ status: 'unavailable' })])).toBe(initialSubmitState);
    expect(run([{ type: 'submit-pressed' }], inFlight)).toBe(inFlight);
    expect(run([returned()], inFlight)).toBe(inFlight);
  });
});

describe('dialog problem copy', () => {
  const dates = { statementDate: '2027-11-01', dueDate: '2027-12-31' };

  it('names the dates the conflict is about', () => {
    expect(problemMessage('error', dates)).toBe('Your declaration was not submitted. Try again.');
    expect(problemMessage('before-statement-date', dates)).toBe('You can submit from 1 Nov 2027.');
    expect(problemMessage('amendment-window-closed', dates)).toBe(
      'Amendments closed on 31 Dec 2027. Contact your Commission.',
    );
    expect(problemMessage('amendment-window-closed', { ...dates, dueDate: null })).toBe(
      'Amendments are closed. Contact your Commission.',
    );
    expect(problemMessage('not-a-draft', dates)).toBe(
      'This declaration changed in another window. Reload to see its current state.',
    );
    expect(problemMessage('obligation-cancelled', dates)).toContain('no longer required');
  });
});
