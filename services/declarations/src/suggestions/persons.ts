import type { PersonKey } from '@adili/forms';

import { isRecord } from '../guards.js';
import type { SectionContents } from '../drafts/sections.js';
import type { StatementItem } from './match-keys.js';

/**
 * Who a lookup can be for, and by which national ID (spec 05b, pure). The declarant (`officer`) is
 * looked up by the national ID on their person record; a spouse or child by the one entered in
 * Household.
 */

const HOUSEHOLD_PERSON = /^(spouse|child):([0-9a-f-]{36})$/;

/** A spouse or child as Household lists them: present or not, and their national ID if given. */
export type HouseholdPerson = { listed: false } | { listed: true; nationalId: string | null };

/**
 * The household person `personKey` names (`spouse:<id>`, `child:<id>`), from the household
 * section as saved (possibly partial). Not listed for the declarant or any other key.
 */
export function householdPerson(contents: SectionContents, personKey: string): HouseholdPerson {
  const match = HOUSEHOLD_PERSON.exec(personKey);
  if (!match) return { listed: false };
  const [, relation, id] = match;
  const group = contents[relation === 'spouse' ? 'spouses' : 'children'];
  const items: unknown[] = isRecord(group) && Array.isArray(group.items) ? group.items : [];
  const person = items.find(
    (item) => isRecord(item) && typeof item.id === 'string' && item.id.toLowerCase() === id,
  );
  if (!isRecord(person)) return { listed: false };
  const nationalId = typeof person.nationalId === 'string' ? person.nationalId.trim() : '';
  return { listed: true, nationalId: nationalId || null };
}

export function isOfficer(personKey: string): personKey is 'officer' {
  return personKey === 'officer';
}

export function isHouseholdPersonKey(
  personKey: string,
): personKey is Exclude<PersonKey, 'officer'> {
  return HOUSEHOLD_PERSON.test(personKey);
}

/** The declarant (`officer`), a spouse or a child. */
export function isPersonKey(personKey: string): personKey is PersonKey {
  return isOfficer(personKey) || isHouseholdPersonKey(personKey);
}

/**
 * The items of a financial statement as saved (possibly partial), for matching: those with an
 * id and a type, of every category.
 */
export function statementItems(contents: SectionContents): StatementItem[] {
  return ['income', 'assets', 'liabilities'].flatMap((category) => {
    const list = contents[category];
    return Array.isArray(list)
      ? list.filter(
          (item): item is StatementItem =>
            isRecord(item) && typeof item.id === 'string' && typeof item.type === 'string',
        )
      : [];
  });
}
