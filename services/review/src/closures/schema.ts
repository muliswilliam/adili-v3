import { index, integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Bulk closure (spec 08): the runs of the daily closure sweep and the supervisors' bulk approvals.
 * Tenant data under the same row-level security as every review table.
 */

/**
 * One run of `BulkClosureSweep` for a Commission and cycle: how many eligible cases it proposed
 * as `compliant-no-issues` and how many it diverted to review at the sample rate it used.
 */
export const closureSweeps = pgTable(
  'closure_sweeps',
  {
    /** Chosen by the workflow, so a retried record of the same run is written once. */
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    cycleYear: integer().notNull(),
    ranAt: timestamp({ withTimezone: true }).notNull(),
    /** Fraction of eligible cases diverted to review, e.g. 0.02. */
    sampleRate: real().notNull(),
    proposed: integer().notNull(),
    sampled: integer().notNull(),
  },
  (table) => [
    index('closure_sweeps_tenant_cycle_idx').on(table.tenant, table.cycleYear, table.ranAt),
  ],
);

/**
 * A supervisor's bulk approval of system-proposed closures, one per approver and idempotency key:
 * a request that failed part way and is sent again with the same key resumes it, so its result
 * counts every chunk approved under it. Determinations approved by it name it.
 */
export const bulkApprovals = pgTable('bulk_approvals', {
  id: uuid().primaryKey(),
  tenant: text().notNull(),
  approver: text().notNull(),
  cycleYear: integer().notNull(),
  type: text(),
  chunks: integer().notNull().default(0),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  completedAt: timestamp({ withTimezone: true }),
});

export const closuresSchema = { closureSweeps, bulkApprovals };
