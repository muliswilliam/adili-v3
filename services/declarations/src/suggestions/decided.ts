import type { SectionContents } from '../drafts/sections.js';
import { sectionItems, text } from './item-sources.js';
import {
  type Comparable,
  companyKeys,
  kraPinMatchKey,
  type MatchKey,
  matchKeysOfItem,
  presentKeys,
} from './match-keys.js';

/**
 * Which of the declarant's decisions on a registry's suggestions still stand (spec 05b, S5; pure):
 * when the registry is checked again, a repeat of a standing decision arrives `superseded`
 * (`repeatsDecided`), anything else `new`; when a section is saved, an acceptance that no longer
 * stands is reopened (`reopening.ts`).
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
  const held = heldKeys(decision.sectionKey, section, decision.acceptedItemId);
  if (held === null) return false;
  if (decision.matchKeys.length === 0) return true;
  return decision.matchKeys.some((key) => held.includes(key));
}

/**
 * The identifiers of item `itemId` as the section holds it (`sectionItems`): a statement item's
 * own, a directorship's company, a spouse's KRA PIN. Null when the section holds no such item.
 */
export function heldKeys(
  sectionKey: string,
  section: SectionContents,
  itemId: string,
): MatchKey[] | null {
  const item = sectionItems(sectionKey, section).find((each) => each.id === itemId);
  if (!item) return null;
  if (sectionKey === 'other') return companyKeys(text(item.company));
  if (sectionKey === 'household') return presentKeys(kraPinMatchKey(text(item.kraPin)));
  return matchKeysOfItem(item);
}

/** Whether a suggestion's status is a decision the declarant made. */
export function isDecided(status: string): status is Decision['status'] {
  return status === 'accepted' || status === 'dismissed';
}
