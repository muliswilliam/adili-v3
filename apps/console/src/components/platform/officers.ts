import type { LeaOfficerAccount } from '../../server/directory/client';

/** The officers list's state filter: everyone, or one account state (the prototype's chips). */
export const OFFICER_FILTERS = ['all', 'activated', 'invited', 'revoked'] as const;
export type OfficerFilter = (typeof OFFICER_FILTERS)[number];

/** Officers per page. */
export const OFFICERS_PAGE_SIZE = 20;

/** How many officers each filter shows, before the search. */
export function filterCounts(
  officers: readonly LeaOfficerAccount[],
): Record<OfficerFilter, number> {
  const counts: Record<OfficerFilter, number> = {
    all: officers.length,
    activated: 0,
    invited: 0,
    revoked: 0,
  };
  for (const officer of officers) counts[officer.state] += 1;
  return counts;
}

/** The officers a filter and search (part of a name or email, any case) leave, in name order. */
export function filterOfficers(
  officers: readonly LeaOfficerAccount[],
  filter: OfficerFilter,
  search: string,
): LeaOfficerAccount[] {
  const text = search.trim().toLowerCase();
  return officers.filter(
    (officer) =>
      (filter === 'all' || officer.state === filter) &&
      (!text || `${officer.name} ${officer.email}`.toLowerCase().includes(text)),
  );
}
