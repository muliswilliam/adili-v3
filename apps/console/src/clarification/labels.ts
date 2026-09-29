import type { ClarificationStatus, Requirement } from '../server/review/types';

/**
 * The words and tones of a clarification in the console (spec 07a FE-4): its statuses and what
 * each item requires. Keyed by the contract's types, so a value the contract adds is a type error
 * here until it has words.
 */

/** Colour intent, shared by status badges and callouts; screens map it to a component variant. */
export type Tone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'destructive';

/** Each status once: its label, its tone, and whether it still waits on someone. */
export const CLARIFICATION_STATUSES = {
  draft: { label: 'Draft', tone: 'neutral', outstanding: false },
  issued: { label: 'Issued', tone: 'info', outstanding: true },
  responded: { label: 'Responded', tone: 'brand', outstanding: true },
  resolved: { label: 'Resolved', tone: 'success', outstanding: false },
  overdue: { label: 'Overdue', tone: 'destructive', outstanding: true },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', outstanding: false },
} satisfies Record<ClarificationStatus, { label: string; tone: Tone; outstanding: boolean }>;

/** Still waiting on the declarant or the reviewer, so the case stays awaiting clarification. */
export function isOutstanding(status: ClarificationStatus): boolean {
  return CLARIFICATION_STATUSES[status].outstanding;
}

/** Act s.35(4), in the words the composer and the letter use. */
export const REQUIREMENT_LABELS = {
  'provide-omitted': 'Provide the omitted information',
  'explain-discrepancy': 'Explain the discrepancy or inconsistency',
  correct: 'Correct the entry',
} satisfies Record<Requirement, string>;
