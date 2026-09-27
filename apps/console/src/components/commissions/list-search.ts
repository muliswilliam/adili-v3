import { z } from 'zod';

/**
 * Filters of the Commissions list, kept in the URL so a view can be shared. Unknown values are
 * dropped rather than failing the page.
 */
export const commissionListSearch = z.object({
  search: z.string().trim().min(1).max(100).optional().catch(undefined),
  type: z.enum(['hosted', 'federated']).optional().catch(undefined),
  reportingOfficer: z.enum(['none', 'invited', 'activated']).optional().catch(undefined),
});

export type CommissionListSearch = z.infer<typeof commissionListSearch>;

export function hasFilters(search: CommissionListSearch): boolean {
  return Boolean(search.search ?? search.type ?? search.reportingOfficer);
}

/** Wait this long after the last keystroke before searching (spec 01). */
export const SEARCH_DEBOUNCE_MS = 300;
