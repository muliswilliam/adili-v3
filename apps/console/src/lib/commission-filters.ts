import { z } from 'zod';

import type { CommissionType, ReportingOfficerFilter } from '../server/directory/types';

/** Lists every member of a contract union exactly once, so a new enum value fails typecheck. */
function allOf<T extends string>() {
  return <const L extends readonly T[]>(
    list: L & ([T] extends [L[number]] ? unknown : { missing: Exclude<T, L[number]> }),
  ) => list;
}

/** `CommissionType` from the directory contract, as runtime values in display order. */
export const COMMISSION_TYPES = allOf<CommissionType>()(['hosted', 'federated']);

/** The list's reporting-officer filter values from the contract, in display order. */
export const REPORTING_OFFICER_FILTERS = allOf<ReportingOfficerFilter>()([
  'none',
  'invited',
  'activated',
]);

/**
 * Commissions list filters as URL search params, so a filtered view can be shared. Unknown
 * values fall back to "no filter" rather than failing the route.
 */
export const commissionFiltersSchema = z.object({
  search: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(COMMISSION_TYPES).optional().catch(undefined),
  reportingOfficer: z.enum(REPORTING_OFFICER_FILTERS).optional().catch(undefined),
});

export type CommissionFilters = z.infer<typeof commissionFiltersSchema>;

/**
 * The list's search params: the filters and the directory cursor of the page on show, so Back,
 * reload and shared links open the same page.
 */
export const commissionListSearchSchema = commissionFiltersSchema.extend({
  cursor: z.string().min(1).optional().catch(undefined),
});

export type CommissionListSearch = z.infer<typeof commissionListSearchSchema>;

export function hasFilters(filters: CommissionFilters): boolean {
  return Boolean(filters.search) || Boolean(filters.type) || Boolean(filters.reportingOfficer);
}

/**
 * The search params for a new set of filters. The cursor belongs to the old result set, so a
 * filter change always starts again from the first page.
 */
export function searchForFilters(filters: CommissionFilters): CommissionListSearch {
  return {
    search: filters.search === '' ? undefined : filters.search,
    type: filters.type,
    reportingOfficer: filters.reportingOfficer,
  };
}

/** Just the filters of the list's search params. */
export function filtersOf(search: CommissionListSearch): CommissionFilters {
  return searchForFilters(search);
}
