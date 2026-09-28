import { z } from 'zod';

/**
 * Filters of the Commissions list and the directory cursor of the page on show, kept in the URL
 * so a view (and page) can be shared, reloaded and reached with Back. Unknown values are dropped
 * rather than failing the page.
 */
export const commissionListSearch = z.object({
  search: z.string().trim().min(1).max(100).optional().catch(undefined),
  type: z.enum(['hosted', 'federated']).optional().catch(undefined),
  reportingOfficer: z.enum(['none', 'invited', 'activated']).optional().catch(undefined),
  cursor: z.string().min(1).optional().catch(undefined),
});

export type CommissionListSearch = z.infer<typeof commissionListSearch>;

export type CommissionFilters = Omit<CommissionListSearch, 'cursor'>;

export function hasFilters(search: CommissionFilters): boolean {
  return Boolean(search.search ?? search.type ?? search.reportingOfficer);
}

/** The filters of a search; the cursor belongs to its result set, so filter changes drop it. */
export function filtersOf({
  search,
  type,
  reportingOfficer,
}: CommissionFilters): CommissionFilters {
  return { search, type, reportingOfficer };
}
