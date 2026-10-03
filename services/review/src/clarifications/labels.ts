import type { DeclarationV1, PersonName } from '@adili/forms';

import { CATEGORIES, type Category } from '../rules/match.js';
import type { ClarificationItem, LetterLanguage, REQUIREMENTS } from '../cases/schema.js';

export type Requirement = (typeof REQUIREMENTS)[number];

/**
 * What Act s.35(4) requires of the declarant, as the letter states it, in each letter language.
 * The console composer uses the same wording, so the reviewer's choice and the letter agree.
 */
export const REQUIREMENT_LABELS: Record<LetterLanguage, Record<Requirement, string>> = {
  en: {
    'provide-omitted': 'Provide the omitted information',
    'explain-discrepancy': 'Explain the discrepancy or inconsistency',
    correct: 'Correct the entry',
  },
  sw: {
    'provide-omitted': 'Toa taarifa zilizoachwa',
    'explain-discrepancy': 'Eleza tofauti au kutowiana kwa taarifa',
    correct: 'Sahihisha taarifa iliyoandikwa',
  },
};

/** The words of an item's label in each letter language: sections, categories and fallbacks. */
const LABEL_WORDS: Record<
  LetterLanguage,
  {
    sections: Record<string, string>;
    categories: Record<Category, string>;
    statement: string;
    declaration: string;
  }
> = {
  en: {
    sections: {
      bio: 'Personal details',
      household: 'Spouses and children',
      other: 'Other information',
    },
    categories: { income: 'Income', assets: 'Assets', liabilities: 'Liabilities' },
    statement: 'Financial statement',
    declaration: 'Declaration',
  },
  sw: {
    sections: {
      bio: 'Taarifa binafsi',
      household: 'Wenzi wa ndoa na watoto',
      other: 'Taarifa nyingine',
    },
    categories: { income: 'Mapato', assets: 'Mali', liabilities: 'Madeni' },
    statement: 'Taarifa ya kifedha',
    declaration: 'Tamko',
  },
};

/**
 * The human label of what a clarification item concerns, e.g. "Assets · Plot in Kisumu · Grace
 * Otieno", read from the declaration as filed, in the letter's language (descriptions and names
 * as filed). Content is used here, for the letter, and never stored. A target the document no
 * longer has falls back to its section.
 */
export function itemLabel(
  item: ClarificationItem,
  document: DeclarationV1 | null,
  language: LetterLanguage,
): string {
  const words = LABEL_WORDS[language];
  const statement = document?.statements.find(
    (candidate) => candidate.personKey === (item.personKey ?? personKeyOf(item.sectionKey)),
  );
  if (item.itemId !== null && document) {
    for (const each of document.statements) {
      for (const category of CATEGORIES) {
        const found = each[category].find((candidate) => candidate.id === item.itemId);
        if (found) {
          return [words.categories[category], found.description, fullName(each.personName)].join(
            ' · ',
          );
        }
      }
    }
  }
  if (statement) return [words.statement, fullName(statement.personName)].join(' · ');
  if (item.personKey !== null || item.sectionKey?.startsWith('statement:')) return words.statement;
  return (item.sectionKey && words.sections[item.sectionKey]) ?? words.declaration;
}

function personKeyOf(sectionKey: string | null): string | null {
  return sectionKey?.startsWith('statement:') ? sectionKey.slice('statement:'.length) : null;
}

function fullName(name: PersonName): string {
  return [name.firstName, name.otherNames, name.surname].filter(Boolean).join(' ');
}
