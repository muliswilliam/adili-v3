import type { PersonKey } from '@adili/forms';

import type { Transaction } from '../db/transaction.js';
import { sectionIs } from '../drafts/repository.js';
import { declarationSections } from '../drafts/schema.js';
import type { SectionCipher } from '../drafts/section-cipher.js';
import { type HouseholdPerson, householdPerson } from './persons.js';

/**
 * The spouse or child `personKey` names, as the draft's Household is saved now: not listed when
 * the section is not saved yet or does not list them.
 */
export async function savedHouseholdPerson(
  tx: Transaction,
  sections: SectionCipher,
  declaration: { id: string; tenant: string },
  personKey: Exclude<PersonKey, 'officer'>,
): Promise<HouseholdPerson> {
  const [section] = await tx
    .select()
    .from(declarationSections)
    .where(sectionIs(declaration.id, 'household'));
  return section
    ? householdPerson(await sections.open(declaration.tenant, section), personKey)
    : { listed: false };
}
