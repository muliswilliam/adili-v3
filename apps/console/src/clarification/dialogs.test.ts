import { describe, expect, it } from 'vitest';

import { resolveNoteError, resolveOutcome, withdrawReasonError } from './dialogs';

describe('dialogs', () => {
  it('requires a resolution note of up to 2,000 characters', () => {
    expect(resolveNoteError('  ')).toBe('Add a note so colleagues know why it is resolved.');
    expect(resolveNoteError('x'.repeat(2001))).toBe('Keep the note to 2,000 characters or fewer.');
    expect(resolveNoteError('Explained with a loan statement.')).toBeNull();
  });

  it('requires a withdrawal reason of up to 1,000 characters', () => {
    expect(withdrawReasonError('')).toBe('Give a reason. It is kept with the record.');
    expect(withdrawReasonError('x'.repeat(1001))).toBe(
      'Keep the reason to 1,000 characters or fewer.',
    );
    expect(withdrawReasonError('Issued against the wrong item')).toBeNull();
  });

  it('says what resolving does to the case', () => {
    expect(resolveOutcome(0)).toBe('The case becomes ready for determination.');
    expect(resolveOutcome(2)).toBe(
      '2 other clarifications still open. The case stays awaiting clarification.',
    );
    expect(resolveOutcome(1)).toBe(
      '1 other clarification still open. The case stays awaiting clarification.',
    );
  });
});
