import { z } from 'zod';

import type { ListRosterRecordsQuery } from '../../server/directory/client';

export const RECORD_STATES = ['not_onboarded', 'onboarded', 'exited'] as const;

/** Page size of the records list: the directory's default. */
export const RECORDS_PAGE_SIZE = 50;

/**
 * Filters of the roster records list, kept in the URL so a view can be shared, reloaded and
 * reached with Back. Unknown values are dropped rather than failing the page, and switched-off
 * toggles are left out rather than kept as `false`. Pages come from "Load more" and are not part
 * of the URL. `identityMismatch` is the spec 03 filter (S25) for records whose identity check
 * against the national register failed; the directory contract does not list it yet.
 */
export const recordsSearchSchema = z.object({
  search: z.string().trim().min(1).max(200).optional().catch(undefined),
  state: z.enum(RECORD_STATES).optional().catch(undefined),
  flagged: z.literal(true).optional().catch(undefined),
  identityMismatch: z.literal(true).optional().catch(undefined),
});

export type RecordsSearch = z.infer<typeof recordsSearchSchema>;

export function hasRecordFilters(search: RecordsSearch): boolean {
  return Boolean(search.search ?? search.state ?? search.flagged ?? search.identityMismatch);
}

/**
 * The directory's query for a set of filters and the page after `cursor`. Off switches are left
 * out, not sent as false.
 */
export function rosterRecordsQuery(
  filters: RecordsSearch,
  page: { cursor?: string | null; limit?: number } = {},
): ListRosterRecordsQuery & { identityMismatch?: true } {
  const query: ListRosterRecordsQuery & { identityMismatch?: true } = {};
  const search = filters.search?.trim();
  if (search) query.search = search;
  if (filters.state) query.state = filters.state;
  if (filters.flagged) query.flagged = true;
  if (filters.identityMismatch) query.identityMismatch = true;
  if (page.cursor) query.cursor = page.cursor;
  if (page.limit !== undefined) query.limit = page.limit;
  return query;
}

/** Turns "Flagged only" on or off. */
export function toggleFlagged(filters: RecordsSearch): RecordsSearch {
  const next: RecordsSearch = { ...filters, flagged: filters.flagged ? undefined : true };
  if (!next.flagged) delete next.flagged;
  return next;
}

/** Turns the identity-mismatch filter on or off. */
export function toggleIdentityMismatch(filters: RecordsSearch): RecordsSearch {
  const next: RecordsSearch = {
    ...filters,
    identityMismatch: filters.identityMismatch ? undefined : true,
  };
  if (!next.identityMismatch) delete next.identityMismatch;
  return next;
}

/**
 * The hint under "No matches". National IDs match only in full, so a search of digits alone
 * that found nothing is most likely a partial ID.
 */
export function noMatchesHint(search: RecordsSearch): 'partial-national-id' | 'other' {
  return search.search && /^\d+$/.test(search.search.replace(/\s/g, ''))
    ? 'partial-national-id'
    : 'other';
}

/** Records loaded so far and the cursor of the page after them (null at the end). */
export interface LoadedPages<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * The list after "Load more": the next page appended. A record already on show (the roster
 * changed between pages and it moved) is not listed twice.
 */
export function appendPage<T extends { id: string }>(
  loaded: LoadedPages<T>,
  page: LoadedPages<T>,
): LoadedPages<T> {
  const seen = new Set(loaded.items.map((item) => item.id));
  return {
    items: [...loaded.items, ...page.items.filter((item) => !seen.has(item.id))],
    nextCursor: page.nextCursor,
  };
}
