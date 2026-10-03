import { describe, expect, it } from 'vitest';

import {
  type ConfirmEvent,
  confirmReducer,
  type ConfirmState,
  initialConfirmState,
} from './confirm';

const run = (events: ConfirmEvent[], from: ConfirmState = initialConfirmState) =>
  events.reduce(confirmReducer, from);

const confirming: ConfirmEvent[] = [
  { type: 'confirm-pressed' },
  { type: 'step-up-returned', confirmed: true, key: 'key-1' },
];

describe('confirming Form M with a step-up (S6)', () => {
  it('leaves for the step-up first, then opens the dialog with a fresh key', () => {
    expect(run([{ type: 'confirm-pressed' }])).toEqual({ step: 'stepping-up' });
    expect(run(confirming)).toEqual({
      step: 'confirm',
      key: 'key-1',
      checked: false,
      failed: false,
    });
  });

  it('says the identity was not confirmed when the step-up fails, and lets them try again', () => {
    const failed = run([
      { type: 'confirm-pressed' },
      { type: 'step-up-returned', confirmed: false, key: 'key-1' },
    ]);
    expect(failed).toEqual({ step: 'step-up-failed' });
    expect(confirmReducer(failed, { type: 'confirm-pressed' })).toEqual({ step: 'stepping-up' });
  });

  it('submits only once "I confirm the information is correct" is ticked', () => {
    const open = run(confirming);
    expect(confirmReducer(open, { type: 'submit-pressed' })).toBe(open);
    const ticked = confirmReducer(open, { type: 'checked', checked: true });
    expect(confirmReducer(ticked, { type: 'submit-pressed' })).toEqual({
      step: 'submitting',
      key: 'key-1',
    });
  });

  it('keeps the dialog and its key open on a failure, to try again', () => {
    const sent = run([
      ...confirming,
      { type: 'checked', checked: true },
      { type: 'submit-pressed' },
    ]);
    const failed = confirmReducer(sent, { type: 'answered', answer: { status: 'unavailable' } });
    expect(failed).toEqual({ step: 'confirm', key: 'key-1', checked: true, failed: true });
    expect(confirmReducer(failed, { type: 'submit-pressed' })).toEqual({
      step: 'submitting',
      key: 'key-1',
    });
  });

  it.each([
    [
      { status: 'submitted', reference: 'RPT-PSC-2026-0000001-K', late: true },
      { step: 'submitted' },
    ],
    [{ status: 'step-up-required' }, { step: 'step-up-failed' }],
    [{ status: 'unauthenticated' }, { step: 'signed-out' }],
    [{ status: 'not-reviewed' }, { step: 'refused', reason: 'not-reviewed' }],
    [{ status: 'compiling' }, { step: 'refused', reason: 'compiling' }],
    [{ status: 'already-submitted' }, { step: 'refused', reason: 'already-submitted' }],
    [
      { status: 'incomplete', paths: ['partI.emailAddress'] },
      { step: 'refused', reason: 'incomplete', paths: ['partI.emailAddress'] },
    ],
    [{ status: 'forbidden' }, { step: 'confirm', key: 'key-1', checked: true, failed: true }],
  ] as const)('moves on after %o', (answer, next) => {
    const sent = run([
      ...confirming,
      { type: 'checked', checked: true },
      { type: 'submit-pressed' },
    ]);
    expect(confirmReducer(sent, { type: 'answered', answer })).toEqual(next);
  });

  it('cannot close the dialog while submitting, and closing it drops the key', () => {
    const sent = run([
      ...confirming,
      { type: 'checked', checked: true },
      { type: 'submit-pressed' },
    ]);
    expect(confirmReducer(sent, { type: 'dialog-closed' })).toBe(sent);
    expect(run([...confirming, { type: 'dialog-closed' }])).toEqual(initialConfirmState);
  });

  it('ignores a step-up return it did not ask for after a refusal is shown', () => {
    const refused: ConfirmState = { step: 'refused', reason: 'not-reviewed' };
    expect(confirmReducer(refused, { type: 'step-up-returned', confirmed: true, key: 'k' })).toBe(
      refused,
    );
  });
});
