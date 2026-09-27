import { z } from 'zod';

/**
 * Filters on the roster records list (`GET /v1/commissions/{slug}/roster/records`), as the
 * records route's search params. `identityMismatch` is the spec 03 filter (S25) for records
 * whose identity check against the national register failed; the directory contract draft does
 * not list it yet, so it is declared here until the contract and generated types catch up.
 */
export const recordsSearchSchema = z.object({
  search: z.string().max(200).optional(),
  state: z.enum(['not_onboarded', 'onboarded', 'exited']).optional(),
  flagged: z.boolean().optional(),
  identityMismatch: z.boolean().optional(),
  cursor: z.string().optional(),
});

export type RecordsSearch = z.infer<typeof recordsSearchSchema>;

/** The directory's query string for a set of filters. Off switches are left out, not sent false. */
export function rosterRecordsQuery(filters: RecordsSearch, limit?: number): URLSearchParams {
  const query = new URLSearchParams();
  const search = filters.search?.trim();
  if (search) query.set('search', search);
  if (filters.state) query.set('state', filters.state);
  if (filters.flagged) query.set('flagged', 'true');
  if (filters.identityMismatch) query.set('identityMismatch', 'true');
  if (filters.cursor) query.set('cursor', filters.cursor);
  if (limit !== undefined) query.set('limit', String(limit));
  return query;
}

/** Turns the identity-mismatch filter on or off, back on the first page. */
export function toggleIdentityMismatch(filters: RecordsSearch): RecordsSearch {
  const next: RecordsSearch = { ...filters, identityMismatch: !filters.identityMismatch };
  delete next.cursor;
  if (!next.identityMismatch) delete next.identityMismatch;
  return next;
}
