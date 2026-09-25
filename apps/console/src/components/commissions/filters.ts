import { z } from 'zod';

/**
 * Commissions list filters as URL search params, so a filtered view can be shared. Unknown
 * values fall back to "no filter" rather than failing the route.
 */
export const commissionFiltersSchema = z.object({
  search: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(['hosted', 'federated']).optional().catch(undefined),
  reportingOfficer: z.enum(['none', 'invited', 'activated']).optional().catch(undefined),
});

export type CommissionFilters = z.infer<typeof commissionFiltersSchema>;

export function hasFilters(filters: CommissionFilters): boolean {
  return Boolean(filters.search) || Boolean(filters.type) || Boolean(filters.reportingOfficer);
}
