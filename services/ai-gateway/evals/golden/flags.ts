import type { SourceRef } from '../lib/refs.js';

/**
 * Risk flags as the review service raises them (services/review/src/rules): the same rule ids,
 * titles, indicators and evidence shapes, so prompts are measured on what production sends.
 * Evidence carries no amounts. The review service gives each flag an id when it stores it; the
 * registry rules are in the review contract (spec 07b) with wording written here.
 */

const RULES = {
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
  'registry-vehicle-undeclared': {
    title: 'Registered vehicle not declared',
    indicator:
      'NTSA lists a vehicle registered to the declarant that the declaration does not include. It may have been sold or transferred without the registry being updated.',
  },
} as const;

export type RuleId = keyof typeof RULES;

export interface FlagInput {
  id: string;
  ruleId: RuleId;
  severity: 'info' | 'low' | 'medium' | 'high';
  title: string;
  indicator: string;
  evidence: Record<string, string | number | boolean | null | string[]>;
  itemRefs: SourceRef[];
}

/** A flag with an id from the eval range. */
export function flag(
  n: number,
  ruleId: RuleId,
  severity: FlagInput['severity'],
  evidence: FlagInput['evidence'],
  itemRefs: SourceRef[] = [],
): FlagInput {
  const id = `0199e0a0-f1a6-7000-8000-${String(n).padStart(12, '0')}`;
  return { id, ruleId, severity, ...RULES[ruleId], evidence, itemRefs };
}

/** A ref to an item in a person's statement, as the review rules make them. */
export function itemRef(personKey: string, itemId: string | null): SourceRef {
  return { sectionKey: `statement:${personKey}`, personKey, itemId, fieldPath: null };
}
