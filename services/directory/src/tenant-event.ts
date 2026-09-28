import type { NewEvent } from '@adili/events';

/**
 * The factory of one type of the directory's events about a Commission: the `tenant` extension
 * is the Commission's slug, and `subjectOf` picks the subject (an id in the data, or the slug).
 *
 * @example
 * export const rosterImportFailed = tenantEvent<RosterImportFailedData>(
 *   ROSTER_IMPORT_FAILED,
 *   (data) => data.importId,
 * );
 * events.record(tx, rosterImportFailed('psc', data));
 */
export function tenantEvent<TData extends Record<string, unknown>>(
  type: string,
  subjectOf: (data: TData, slug: string) => string,
): (slug: string, data: TData) => NewEvent<TData> {
  return (slug, data) => ({ type, subject: subjectOf(data, slug), tenant: slug, data });
}
