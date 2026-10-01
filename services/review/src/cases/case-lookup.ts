import { notFoundIfInvisible } from '@adili/api-kit';
import type { Database } from '@adili/data-access';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { ReviewSchema } from '../db/schema.js';
import { caseListItem, type CaseListItem } from './representation.js';
import { clarifications, reviewCases } from './schema.js';

/** A transaction on the review database, under a tenant's row-level security. */
export type ReviewTransaction = Parameters<Parameters<Database<ReviewSchema>['transaction']>[0]>[0];

export type CaseRow = typeof reviewCases.$inferSelect;

const uuid = z.uuid();

/** `id` when it is a UUID; 404 otherwise, as for any id that names nothing visible. */
export function visibleId(id: string): string {
  return notFoundIfInvisible(uuid.safeParse(id).success ? id : null);
}

/**
 * The case `caseId` of the transaction's tenant (row-level security hides the others), locked
 * for update when `lock` is set; 404 when there is none.
 */
export async function findCase(
  tx: ReviewTransaction,
  tenant: string,
  caseId: string,
  { lock = false } = {},
): Promise<CaseRow> {
  const query = tx
    .select()
    .from(reviewCases)
    .where(and(eq(reviewCases.id, visibleId(caseId)), eq(reviewCases.tenant, tenant)));
  const [row] = lock ? await query.for('update') : await query;
  return notFoundIfInvisible(row);
}

/** The case as its queue row shows it, with its latest issued clarification. */
export async function caseItem(tx: ReviewTransaction, row: CaseRow): Promise<CaseListItem> {
  const [latest] = await tx
    .select({ status: clarifications.status, dueAt: clarifications.dueAt })
    .from(clarifications)
    .where(and(eq(clarifications.caseId, row.id), ne(clarifications.status, 'draft')))
    .orderBy(sql`${clarifications.issuedAt} desc nulls last`)
    .limit(1);
  return caseListItem(row, latest);
}
