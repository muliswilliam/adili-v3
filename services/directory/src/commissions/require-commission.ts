import { notFoundIfInvisible } from '@adili/api-kit';
import { eq } from 'drizzle-orm';

import { commissions } from '../db/schema.js';
import type { Transaction } from './commissions.service.js';

/**
 * 404 unless the Commission with this slug exists and the transaction's tenant context sees it
 * (RLS): for a tenant-scoped operation to tell a Commission with nothing to show from one that
 * is not there.
 */
export async function requireCommission(tx: Transaction, slug: string): Promise<void> {
  const [commission] = await tx
    .select({ slug: commissions.slug })
    .from(commissions)
    .where(eq(commissions.slug, slug));
  notFoundIfInvisible(commission);
}
