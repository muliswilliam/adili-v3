import type { SectionContents } from '../drafts/sections.js';
import { isRecord, recordOf } from '../guards.js';
import {
  type Comparable,
  companyKeys,
  kraPinMatchKey,
  type MatchKey,
  matchKeysOfItem,
  presentKeys,
} from './match-keys.js';
import { statementItems } from './persons.js';

/**
 * Which of the declarant's decisions on a registry's suggestions still stand when the registry is
 * checked again (spec 05b, S5; pure): a repeat of a standing decision arrives `superseded`
 * (`repeatsDecided`), anything else `new`.
 */

/** An accepted or dismissed suggestion, as the re-check weighs it. */
export interface Decision extends Comparable {
  status: 'accepted' | 'dismissed';
  /** The item an accepted suggestion went into. */
  acceptedItemId: string | null;
}

/**
 * Whether the decision stands, given the section the suggestion went into as saved now: a
 * dismissal always (story 15); an acceptance while its item is still there and still holds one
 * of the suggestion's identifiers (just still there, for the income hint, which has none). A
 * suggestion whose item the declarant deleted, or whose identifier they changed or cleared (a
 * spouse's KRA PIN), is offered again.
 */
export function decisionStands(decision: Decision, section: SectionContents | undefined): boolean {
  if (decision.status === 'dismissed') return true;
  if (decision.acceptedItemId === null || section === undefined) return false;
  const held = itemKeys(decision.sectionKey, section, decision.acceptedItemId);
  if (held === null) return false;
  if (decision.matchKeys.length === 0) return true;
  return decision.matchKeys.some((key) => held.includes(key));
}

/**
 * The identifiers of item `itemId` as the section holds it: a statement's income, asset or
 * liability, a paragraph 9 directorship, or a spouse in Household (their KRA PIN). Null when the
 * section holds no such item.
 */
function itemKeys(sectionKey: string, section: SectionContents, itemId: string): MatchKey[] | null {
  if (sectionKey.startsWith('statement:')) {
    const item = statementItems(section).find((each) => each.id === itemId);
    return item ? matchKeysOfItem(item) : null;
  }
  const items =
    sectionKey === 'other'
      ? recordOf(section.registrableInterests).directorships
      : sectionKey === 'household'
        ? recordOf(section.spouses).items
        : undefined;
  const item: unknown = Array.isArray(items)
    ? (items as unknown[]).find((each) => isRecord(each) && each.id === itemId)
    : undefined;
  if (!isRecord(item)) return null;
  if (sectionKey === 'other') {
    return typeof item.company === 'string' ? companyKeys(item.company) : [];
  }
  return typeof item.kraPin === 'string' ? presentKeys(kraPinMatchKey(item.kraPin)) : [];
}
