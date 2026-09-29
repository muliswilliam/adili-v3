import type { Database } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReportingSchema } from '../db/schema.js';
import { complianceReports } from './schema.js';

export type ReportingTransaction = Parameters<
  Parameters<Database<ReportingSchema>['transaction']>[0]
>[0];

export type ReportRow = typeof complianceReports.$inferSelect;

/** The Commission's report for the financial year, if any (row-level security applies). */
export async function findReport(
  tx: ReportingTransaction,
  tenant: string,
  fy: number,
): Promise<ReportRow | undefined> {
  const [found] = await tx
    .select()
    .from(complianceReports)
    .where(and(eq(complianceReports.tenant, tenant), eq(complianceReports.fy, fy)));
  return found;
}

/**
 * The Commission's report for the financial year, created `compiling` when there is none: one
 * report per Commission per year (the unique key settles a race).
 */
export async function ensureReport(
  tx: ReportingTransaction,
  tenant: string,
  fy: number,
  at: Date,
): Promise<ReportRow> {
  await tx
    .insert(complianceReports)
    .values({ id: uuidv7(), tenant, fy, status: 'compiling', compileRequestedAt: at })
    .onConflictDoNothing();
  const found = await findReport(tx, tenant, fy);
  if (!found) throw new Error(`No report for ${tenant} ${String(fy)}`);
  return found;
}
