/** review.yaml `Severity`, lowest first. */
export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The wording of each deterministic flag (review.yaml `RuleId`), shared by the console and the
 * clarification letters. Flags are indicators for a reviewer's judgement, never findings, so the
 * texts say what was observed and what might explain it (Agenda Track 6).
 */
export const RULES = {
  'completeness-residual': {
    title: 'Form checks not met at submission',
    indicator:
      'The declaration was submitted with parts the form checks did not accept. It may simply need a correction.',
  },
  'no-previous-version': {
    title: 'First declaration on Adili',
    indicator:
      'There is no earlier declaration on Adili to compare with, so changes since the last one cannot be checked.',
  },
  'value-change-25': {
    title: 'Value changed by 25% or more',
    indicator:
      'The value of this item moved by at least a quarter since the previous declaration. The declarant may have explained it; the change alone is not a concern.',
  },
  'acquisition-unflagged': {
    title: 'New item not marked as new',
    indicator:
      'This item was not in the previous declaration and was not marked as an acquisition or a new source of income.',
  },
  'disposal-unflagged': {
    title: 'Item no longer declared, no disposal recorded',
    indicator:
      'This item was in the previous declaration but not this one, and no disposal, ended source or settlement is recorded in paragraph 9.',
  },
  'change-flag-mismatch': {
    title: 'Change marking differs from the comparison',
    indicator:
      'The declarant marked a change the comparison does not show, or the comparison shows a change of 25% or more that was not marked.',
  },
  'income-vs-asset-growth': {
    title: 'Assets grew faster than declared income',
    indicator:
      'Total declared assets grew by more than the total income declared for the period. Gifts, inheritance or revaluation can explain this.',
  },
  'nil-after-populated': {
    title: 'Declared nil after items were declared before',
    indicator:
      'This category is declared nil although the previous declaration listed items in it.',
  },
  'late-filing': {
    title: 'Submitted after the due date',
    indicator: 'This declaration was submitted after it was due.',
  },
  'foreign-holdings': {
    title: 'Income or assets outside Kenya',
    indicator:
      'The declaration lists income or assets outside Kenya, which the form asks to be declared (First Schedule, note 13).',
  },
  'joint-share-inconsistent': {
    title: 'Joint shares do not add up',
    indicator:
      'The shares declared for a jointly held asset across the household do not add up to 100%. A co-owner outside the household can explain this.',
  },
} as const satisfies Record<string, { title: string; indicator: string }>;

export type RuleId = keyof typeof RULES;
