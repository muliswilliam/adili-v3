import { formatDate } from '@adili/ui';

import type { LoadedSuggestion, LoadedSuggestionSet } from '../server/declarations.server';
import { fieldText } from './suggestions';

/**
 * The declarant's own date and place of birth from IPRS (#612, story 2), pure: which check of
 * theirs is the latest, and what its suggestion says. IPRS is asked only for the declarant, on
 * their request with their consent (spec 05b), and its answer fills the bio only when accepted.
 */

export interface IprsBirth {
  date?: string;
  place?: string;
}

/** The declarant's latest IPRS check, or null when they never asked. */
export function latestIprsSet(sets: readonly LoadedSuggestionSet[]): LoadedSuggestionSet | null {
  const own = sets.filter((set) => set.source === 'iprs' && set.personKey === 'officer');
  return own.reduce<LoadedSuggestionSet | null>(
    (latest, set) => (latest === null || set.requestedAt > latest.requestedAt ? set : latest),
    null,
  );
}

/** The latest check's birth suggestion, not superseded; null when there is none. */
export function birthSuggestion(set: LoadedSuggestionSet | null): LoadedSuggestion | null {
  return (
    set?.suggestions.find(
      (each) => each.itemType === 'bio-birth' && each.status !== 'superseded',
    ) ?? null
  );
}

/** What the suggestion says, in the bio's terms. */
export function birthOf(suggestion: LoadedSuggestion): IprsBirth {
  const date = fieldText(suggestion.fields.dateOfBirth);
  const place = fieldText(suggestion.fields.placeOfBirth);
  return { ...(date ? { date } : {}), ...(place ? { place } : {}) };
}

/** The card's title, e.g. "Born 12 Mar 1984 in Eldoret". */
export function birthTitle(birth: IprsBirth): string {
  const date = birth.date ? formatDate(birth.date) : '';
  if (date && birth.place) return `Born ${date} in ${birth.place}`;
  if (date) return `Born ${date}`;
  return birth.place ? `Born in ${birth.place}` : '';
}

/** Whether the bio already says everything the suggestion does. */
export function bioHolds(bio: IprsBirth, birth: IprsBirth): boolean {
  return (
    (!birth.date || bio.date === birth.date) &&
    (!birth.place || bio.place?.trim().toLowerCase() === birth.place.toLowerCase())
  );
}
