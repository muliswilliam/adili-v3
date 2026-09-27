import { sql } from 'drizzle-orm';

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
 * transaction, so the summary changes atomically with the roster (spec #27). Call it after every
 * change to records' state or flags. `completedImport` also records the import as the latest
 * one (and as the latest complete one when declared complete); its time is the transaction's.
 */
export async function refreshRosterSummary(
  tx: Transaction,
  tenant: string,
  completedImport?: CompletedImport,
): Promise<void> {
  const importId = completedImport?.id ?? null;
  const completeAt = completedImport?.declaredComplete ? sql`now()` : sql`null::timestamptz`;
  const importAt = completedImport ? sql`now()` : sql`null::timestamptz`;
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
