import type { DeclarationV1, PersonName } from '@adili/forms';

import { CATEGORIES, type Category } from '../rules/match.js';
import type { ClarificationItem, REQUIREMENTS } from '../cases/schema.js';

export type Requirement = (typeof REQUIREMENTS)[number];

/**
 * What Act s.35(4) requires of the declarant, as the letter states it. The console composer uses
 * the same wording, so the reviewer's choice and the letter agree.
 */
export const REQUIREMENT_LABELS: Record<Requirement, string> = {
  'provide-omitted': 'Provide the omitted information',
  'explain-discrepancy': 'Explain the discrepancy or inconsistency',
  correct: 'Correct the entry',
};

const SECTION_LABELS: Record<string, string> = {
  bio: 'Personal details',
  household: 'Spouses and children',
  other: 'Other information',
};

const CATEGORY_LABELS: Record<Category, string> = {
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
};

const STATEMENT_LABEL = 'Financial statement';

/**
 * The human label of what a clarification item concerns, e.g. "Assets · Plot in Kisumu · Grace
 * Otieno", read from the declaration as filed. Content is used here, for the letter, and never
 * stored. A target the document no longer has falls back to its section.
 */
export function itemLabel(item: ClarificationItem, document: DeclarationV1 | null): string {
  const statement = document?.statements.find(
    (candidate) => candidate.personKey === (item.personKey ?? personKeyOf(item.sectionKey)),
  );
  if (item.itemId !== null && document) {
    for (const each of document.statements) {
      for (const category of CATEGORIES) {
        const found = each[category].find((candidate) => candidate.id === item.itemId);
        if (found) {
          return [CATEGORY_LABELS[category], found.description, fullName(each.personName)].join(
            ' · ',
          );
        }
      }
    }
  }
  if (statement) return [STATEMENT_LABEL, fullName(statement.personName)].join(' · ');
  if (item.personKey !== null || item.sectionKey?.startsWith('statement:')) return STATEMENT_LABEL;
  return (item.sectionKey && SECTION_LABELS[item.sectionKey]) ?? 'Declaration';
}

function personKeyOf(sectionKey: string | null): string | null {
  return sectionKey?.startsWith('statement:') ? sectionKey.slice('statement:'.length) : null;
}

function fullName(name: PersonName): string {
  return [name.firstName, name.otherNames, name.surname].filter(Boolean).join(' ');
}
