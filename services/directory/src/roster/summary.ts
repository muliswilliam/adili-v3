import { eq, sql } from 'drizzle-orm';

import type { Transaction } from '../commissions/commissions.service.js';
import type { RosterSummary } from '../commissions/representation.js';
import { rosterSummaries } from './schema.js';

/** Columns of a `roster_summaries` row that `toRosterSummary` reads; select them in any query. */
export const rosterSummaryColumns = {
  expected: rosterSummaries.expected,
  onboarded: rosterSummaries.onboarded,
  flagged: rosterSummaries.flagged,
  lastImportId: rosterSummaries.lastImportId,
  lastImportAt: rosterSummaries.lastImportAt,
  lastCompleteImportAt: rosterSummaries.lastCompleteImportAt,
};

interface SummaryRow {
  expected: number | null;
  onboarded: number | null;
  flagged: number | null;
  lastImportId: string | null;
  lastImportAt: Date | null;
  lastCompleteImportAt: Date | null;
}

/**
 * The roster summary of a Commission from its summary row, left-joined, so absent when nothing
 * changed its roster yet. `imported` once an import has completed.
 */
export function toRosterSummary(row: SummaryRow | null): RosterSummary {
  return {
    status: row?.lastImportId ? 'imported' : 'none',
    expectedDeclarants: row?.expected ?? 0,
    onboardedDeclarants: row?.onboarded ?? 0,
    flagged: row?.flagged ?? 0,
    lastImportAt: row?.lastImportAt?.toISOString() ?? null,
    lastImportId: row?.lastImportId ?? null,
    lastCompleteImportAt: row?.lastCompleteImportAt?.toISOString() ?? null,
  };
}

export interface CompletedImport {
  id: string;
  declaredComplete: boolean;
}

/**
 * Recomputes the tenant's roster summary from its records and stores it, in the caller's
 * transaction, so the summary changes atomically with the roster (spec #27). A full count of the
 * tenant's records: run once per import, when it ends (the records its chunks changed count from
 * then on); changes to a known set of records adjust the summary instead (`adjustRosterSummary`).
 * `completedImport` also records the import as the latest one (and as the latest complete one
 * when declared complete); its time is the transaction's.
 *
 * The summary row is locked before counting, so the count sees every record change whose
 * `adjustRosterSummary` came first and none that adjusts after: a delta is never overwritten by
 * a count taken before it committed. Adjusters lock records then the summary; this locks the
 * summary and counts without locking records, so the two cannot deadlock.
 */
export async function refreshRosterSummary(
  tx: Transaction,
  tenant: string,
  completedImport?: CompletedImport,
): Promise<void> {
  const importId = completedImport?.id ?? null;
  const completeAt = completedImport?.declaredComplete ? sql`now()` : sql`null::timestamptz`;
  const importAt = completedImport ? sql`now()` : sql`null::timestamptz`;
  // A row to lock even for the tenant's first count (a concurrent first insert is waited for).
  await tx.execute(sql`
    insert into roster_summaries (tenant, expected, onboarded, flagged, updated_at)
    values (${tenant}, 0, 0, 0, now())
    on conflict (tenant) do nothing
  `);
  await tx.execute(sql`select 1 from roster_summaries where tenant = ${tenant} for update`);
  // A statement of its own after the lock: its snapshot includes whatever the lock waited for.
  await tx.execute(sql`
    insert into roster_summaries
      (tenant, expected, onboarded, flagged, last_import_id, last_import_at, last_complete_import_at, updated_at)
    select
      ${tenant},
      count(*) filter (where state <> 'exited'),
      count(*) filter (where state = 'onboarded'),
      count(*) filter (where absent_from_latest_import and state <> 'exited'),
      ${importId}::uuid,
      ${importAt},
      ${completeAt},
      now()
    from roster_records
    where tenant = ${tenant}
    on conflict (tenant) do update set
      expected = excluded.expected,
      onboarded = excluded.onboarded,
      flagged = excluded.flagged,
      last_import_id = coalesce(excluded.last_import_id, roster_summaries.last_import_id),
      last_import_at = coalesce(excluded.last_import_at, roster_summaries.last_import_at),
      last_complete_import_at =
        coalesce(excluded.last_complete_import_at, roster_summaries.last_complete_import_at),
      updated_at = excluded.updated_at
  `);
}

/** How a change to some records moves the summary's counts. */
export interface RosterSummaryDelta {
  expected: number;
  onboarded: number;
  flagged: number;
}

/**
 * Moves the tenant's roster summary by `delta`, in the caller's transaction, for a change to
 * records the caller has locked and whose before and after it knows (exits, keeps): the cost of
 * the change, not of the roster. Without a summary row yet, counts the records instead. While an
 * import is running, records its chunks changed are counted when it ends, so the counts may be
 * off until then; its full count puts them right.
 */
export async function adjustRosterSummary(
  tx: Transaction,
  tenant: string,
  delta: RosterSummaryDelta,
): Promise<void> {
  const adjusted = await tx
    .update(rosterSummaries)
    .set({
      expected: sql`greatest(0, ${rosterSummaries.expected} + ${delta.expected})`,
      onboarded: sql`greatest(0, ${rosterSummaries.onboarded} + ${delta.onboarded})`,
      flagged: sql`greatest(0, ${rosterSummaries.flagged} + ${delta.flagged})`,
      updatedAt: sql`now()`,
    })
    .where(eq(rosterSummaries.tenant, tenant))
    .returning({ tenant: rosterSummaries.tenant });
  if (adjusted.length === 0) await refreshRosterSummary(tx, tenant);
}
