import { type Database, withTenant } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { and, count, eq, isNotNull, or, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import type { DirectorySchema } from '../../db/schema.js';
import { eventActorOf } from '../actor.js';
import { rosterImportBatches, rosterImportRows, rosterImports } from '../schema.js';
import { refreshRosterSummary } from '../summary.js';
import { rosterImportCompleted, rosterImportFailed } from './events.js';
import type { ImportCounts } from './representation.js';
import { IMPORT_SUBJECT } from './staging.js';
import type { ImportRef, ImportResult } from './workflow-contract.js';

/**
 * Ends an import in one transaction: writes its counts (tallied from its rows, so they are right
 * however often chunks were retried), its state and completion time, deletes the stored rows of
 * an API batch never staged, refreshes the tenant's
 * roster summary and records `roster.import.completed.v1` or `roster.import.failed.v1`.
 *
 * Idempotent: an import that has already ended (or does not exist) is left as it is and no
 * second event is recorded.
 */
export async function finaliseImport(
  db: Database<DirectorySchema>,
  events: EventPublisher,
  ref: ImportRef,
  result: ImportResult,
): Promise<void> {
  await withTenant(db, { tenant: ref.tenant, subject: IMPORT_SUBJECT }, async (tx) => {
    const [current] = await tx
      .select({
        state: rosterImports.state,
        channel: rosterImports.channel,
        declaredComplete: rosterImports.declaredComplete,
        startedByKind: rosterImports.startedByKind,
        startedBy: rosterImports.startedBy,
      })
      .from(rosterImports)
      .where(and(eq(rosterImports.id, ref.importId), eq(rosterImports.tenant, ref.tenant)))
      .for('update');
    if (!current || current.state === 'completed' || current.state === 'failed') return;

    const actor = eventActorOf({ kind: current.startedByKind, id: current.startedBy });
    const counts = await tally(tx, ref.importId, {
      flaggedAbsent: result.state === 'completed' ? (result.flaggedAbsent ?? 0) : 0,
    });
    await tx
      .update(rosterImports)
      .set({
        state: result.state,
        counts,
        completedAt: sql`now()`,
        failureCode: result.state === 'failed' ? result.failure.code : null,
        failureDetail: result.state === 'failed' ? result.failure.detail : null,
      })
      .where(eq(rosterImports.id, ref.importId));
    // An API batch never staged (the import failed first) is not kept: its rows are personal data.
    await tx.delete(rosterImportBatches).where(eq(rosterImportBatches.importId, ref.importId));

    // Chunks applied before a failure changed records too, so the summary is refreshed either way.
    if (result.state === 'completed') {
      await refreshRosterSummary(tx, ref.tenant, {
        id: ref.importId,
        declaredComplete: current.declaredComplete,
      });
      await events.record(
        tx,
        rosterImportCompleted(ref.tenant, {
          importId: ref.importId,
          channel: current.channel,
          declaredComplete: current.declaredComplete,
          counts,
          actor,
        }),
      );
    } else {
      await refreshRosterSummary(tx, ref.tenant);
      await events.record(
        tx,
        rosterImportFailed(ref.tenant, {
          importId: ref.importId,
          failureCode: result.failure.code,
          actor,
        }),
      );
    }
  });
}

/**
 * The import's counts from its rows' statuses and outcomes: the rows it processed, those rejected
 * when staged and those applied. Accepted rows of chunks never applied (the import failed first)
 * are not counted; they changed nothing.
 */
async function tally(
  tx: Transaction,
  importId: string,
  extra: { flaggedAbsent: number },
): Promise<ImportCounts> {
  const groups = await tx
    .select({
      status: rosterImportRows.status,
      outcome: rosterImportRows.outcome,
      rows: count(),
      noted: sql<number>`count(*) filter (where jsonb_array_length(${rosterImportRows.notes}) > 0)::int`,
    })
    .from(rosterImportRows)
    .where(
      and(
        eq(rosterImportRows.importId, importId),
        or(eq(rosterImportRows.status, 'rejected'), isNotNull(rosterImportRows.appliedAt)),
      ),
    )
    .groupBy(rosterImportRows.status, rosterImportRows.outcome);
  const counts: ImportCounts = {
    accepted: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    flaggedAbsent: extra.flaggedAbsent,
    noted: 0,
    exitsRecorded: 0,
  };
  for (const { status, outcome, rows, noted } of groups) {
    counts[status] += rows;
    if (outcome !== null) counts[outcome] += rows;
    counts.noted += noted;
  }
  return counts;
}
