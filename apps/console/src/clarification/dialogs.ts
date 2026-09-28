import { plural } from '@adili/ui';

/** The checks and outcome text of the Mark resolved and Withdraw dialogs (spec 07a S15). */

/** `resolve` body limit in review.yaml. */
export const RESOLVE_NOTE_MAX = 2000;
/** `withdraw` body limit in review.yaml. */
export const WITHDRAW_REASON_MAX = 1000;

export function resolveNoteError(note: string): string | null {
  if (!note.trim()) return 'Add a note so colleagues know why it is resolved.';
  if (note.length > RESOLVE_NOTE_MAX) return 'Keep the note to 2,000 characters or fewer.';
  return null;
}

export function withdrawReasonError(reason: string): string | null {
  if (!reason.trim()) return 'Give a reason. It is kept with the record.';
  if (reason.length > WITHDRAW_REASON_MAX) return 'Keep the reason to 1,000 characters or fewer.';
  return null;
}

/** What resolving does to the case, given the other clarifications still open on it. */
export function resolveOutcome(othersOpen: number): string {
  return othersOpen > 0
    ? `${plural(othersOpen, 'other clarification')} still open. The case stays awaiting clarification.`
    : 'The case becomes ready for determination.';
}
