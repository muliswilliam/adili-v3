import type { Database } from '@adili/data-access';
import { type EventPublisher, type NewEvent } from '@adili/events';
import { and, inArray, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { DeclarationsSchema } from '../db/schema.js';
import type { PulledRosterRecord } from '../directory/directory-client.js';
import type { CivilDate } from './dates.js';
import {
  type CancelReason,
  type CycleCalendar,
  type DesiredObligation,
  type ObligationPolicy,
  type ObligationStatus,
  type PlanOperation,
  planObligations,
} from './engine.js';
import { obligationCreated, obligationStatusChanged } from './events.js';
import { filingObligations, obligationReminders, rosterSnapshots } from './schema.js';
import { noChanges, type ObligationChanges } from './workflows.js';

export type Transaction = Parameters<Parameters<Database<DeclarationsSchema>['transaction']>[0]>[0];

/** What roster records are reconciled against. */
export interface ReconcileContext {
  /** The Commission the records belong to. */
  tenant: string;
  policy: { id: string; rules: ObligationPolicy };
  calendar: CycleCalendar;
  /** Today in Nairobi. */
  today: CivilDate;
}

/** What a page of pulled records is reconciled against. */
export interface PageContext extends ReconcileContext {
  /** The import or exit batch pulled; null for a single record. */
  syncedFrom: string | null;
}

/** Rows per multi-row insert, well under Postgres' 65,535 parameters per statement. */
const INSERT_CHUNK = 1_000;

/**
 * Applies one page of roster records pulled from the directory, in the caller's transaction
 * (scoped to the page's tenant): upserts their snapshots, then reconciles their obligations
 * (`reconcileSnapshots`). Records of another tenant are ignored. Re-applying the same records
 * changes nothing, so a retried page is a no-op. Returns what the obligations' workflows must be
 * told after commit.
 */
export async function applyRosterPage(
  tx: Transaction,
  events: EventPublisher,
  context: PageContext,
  records: readonly PulledRosterRecord[],
): Promise<ObligationChanges> {
  const own = records.filter((record) => record.tenant === context.tenant);
  if (own.length === 0) return noChanges();
  await upsertSnapshots(tx, context, own);
  return reconcileSnapshots(
    tx,
    events,
    context,
    own.map((record) => record.id),
  );
}

/**
 * Runs the obligation engine for the given roster snapshots against their obligations and applies
 * the plan (cancel, supersede, create, link the person) with one event per created or cancelled
 * obligation, in the caller's transaction. `keep` narrows the plan (the cycle opening only
 * creates the cycle's biennials). Returns what the obligations' workflows must be told after
 * commit.
 *
 * The snapshots are locked, so two events touching the same record (an import and an onboarding,
 * or the cycle opening) apply one after the other rather than planning from the same state.
 */
export async function reconcileSnapshots(
  tx: Transaction,
  events: EventPublisher,
  context: ReconcileContext,
  rosterRecordIds: readonly string[],
  keep: (operation: PlanOperation) => boolean = () => true,
): Promise<ObligationChanges> {
  if (rosterRecordIds.length === 0) return noChanges();
  const ids = [...rosterRecordIds];
  const snapshots = await tx
    .select()
    .from(rosterSnapshots)
    .where(inArray(rosterSnapshots.rosterRecordId, ids))
    .for('update');
  const existing = await tx
    .select({
      id: filingObligations.id,
      rosterRecordId: filingObligations.rosterRecordId,
      type: filingObligations.type,
      cycleKey: filingObligations.cycleKey,
      status: filingObligations.status,
      personId: filingObligations.personId,
    })
    .from(filingObligations)
    .where(
      and(
        inArray(filingObligations.rosterRecordId, ids),
        ne(filingObligations.status, 'cancelled'),
      ),
    )
    .for('update');
  const existingByRecord = Map.groupBy(existing, (row) => row.rosterRecordId);

  const plan: { rosterRecordId: string; operation: PlanOperation }[] = [];
  for (const snapshot of snapshots) {
    const { operations } = planObligations({
      record: {
        rosterRecordId: snapshot.rosterRecordId,
        appointmentDate: snapshot.appointmentDate,
        exitDate: snapshot.exitDate,
        personId: snapshot.personId,
        ofr: snapshot.ofr,
      },
      policy: context.policy.rules,
      calendar: context.calendar,
      today: context.today,
      existing: existingByRecord.get(snapshot.rosterRecordId) ?? [],
    });
    for (const operation of operations.filter(keep)) {
      plan.push({ rosterRecordId: snapshot.rosterRecordId, operation });
    }
  }
  const statusOf = new Map(existing.map((row) => [row.id, row.status]));
  return applyPlan(tx, events, context, plan, statusOf);
}

async function upsertSnapshots(
  tx: Transaction,
  context: PageContext,
  records: readonly PulledRosterRecord[],
): Promise<void> {
  const excluded = (column: string) => sql.raw(`excluded.${column}`);
  for (let start = 0; start < records.length; start += INSERT_CHUNK) {
    await tx
      .insert(rosterSnapshots)
      .values(
        records.slice(start, start + INSERT_CHUNK).map((record) => ({
          rosterRecordId: record.id,
          tenant: record.tenant,
          personnelFileNumber: record.personnelFileNumber,
          fullName: record.fullName,
          state: record.state,
          appointmentDate: record.appointmentDate,
          exitDate: record.exitDate,
          personId: record.personId,
          ofr: record.ofr,
          onboardedAt: record.onboardedAt === null ? null : new Date(record.onboardedAt),
          sourceUpdatedAt: new Date(record.updatedAt),
          syncedFrom: context.syncedFrom,
        })),
      )
      .onConflictDoUpdate({
        target: rosterSnapshots.rosterRecordId,
        set: {
          personnelFileNumber: excluded('personnel_file_number'),
          fullName: excluded('full_name'),
          state: excluded('state'),
          appointmentDate: excluded('appointment_date'),
          exitDate: excluded('exit_date'),
          personId: excluded('person_id'),
          ofr: excluded('ofr'),
          onboardedAt: excluded('onboarded_at'),
          sourceUpdatedAt: excluded('source_updated_at'),
          syncedFrom: excluded('synced_from'),
          syncedAt: sql`now()`,
        },
        // A pull older than the stored snapshot (events handled out of order) keeps the newer one.
        setWhere: sql`${rosterSnapshots.sourceUpdatedAt} <= excluded.source_updated_at`,
      });
  }
}

async function applyPlan(
  tx: Transaction,
  events: EventPublisher,
  context: ReconcileContext,
  plan: readonly { rosterRecordId: string; operation: PlanOperation }[],
  statusOf: ReadonlyMap<string, ObligationStatus>,
): Promise<ObligationChanges> {
  const changes = noChanges();
  const newEvents: NewEvent[] = [];
  const cancels: { obligationId: string; reason: CancelReason }[] = [];
  const creates: { rosterRecordId: string; obligation: DesiredObligation }[] = [];
  const links: { obligationIds: string[]; personId: string; ofr: string | null }[] = [];

  for (const { rosterRecordId, operation } of plan) {
    switch (operation.kind) {
      case 'cancel':
        cancels.push({ obligationId: operation.obligationId, reason: operation.reason });
        break;
      case 'supersede':
        cancels.push({ obligationId: operation.obligationId, reason: 'superseded' });
        creates.push({ rosterRecordId, obligation: operation.obligation });
        break;
      case 'create':
        creates.push({ rosterRecordId, obligation: operation.obligation });
        break;
      case 'link-person':
        links.push(operation);
        break;
    }
  }

  // Cancels first: a recreated obligation reuses the cycle key of the one it replaces, and at most
  // one live row per key is allowed.
  for (const [reason, group] of Map.groupBy(cancels, (cancel) => cancel.reason)) {
    await tx
      .update(filingObligations)
      .set({ status: 'cancelled', cancelReason: reason })
      .where(
        inArray(
          filingObligations.id,
          group.map((cancel) => cancel.obligationId),
        ),
      );
    for (const { obligationId } of group) {
      newEvents.push(
        obligationStatusChanged(context.tenant, {
          obligationId,
          from: statusOf.get(obligationId) ?? 'upcoming',
          to: 'cancelled',
          reason,
        }),
      );
      changes.cancelled.push({ obligationId, reason });
    }
  }

  const rows = creates.map(({ rosterRecordId, obligation }) => ({
    id: uuidv7(),
    tenant: context.tenant,
    rosterRecordId,
    personId: obligation.personId,
    ofr: obligation.ofr,
    type: obligation.type,
    cycleKey: obligation.cycleKey,
    statementDate: obligation.statementDate,
    dueDate: obligation.dueDate,
    status: obligation.status,
    policyVersionId: context.policy.id,
    policyVersion: obligation.policyVersion,
  }));
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await tx.insert(filingObligations).values(rows.slice(start, start + INSERT_CHUNK));
  }
  // Reminders already past when the obligation is created are recorded, never sent.
  const skipped = creates.flatMap(({ obligation }, index) =>
    obligation.skippedReminders.map((reminder) => ({
      obligationId: rows[index]?.id ?? '',
      tenant: context.tenant,
      offsetDays: reminder.offsetDays,
      scheduledAt: startOfNairobiDay(reminder.date),
      outcome: 'skipped-past-due-at-creation' as const,
    })),
  );
  for (let start = 0; start < skipped.length; start += INSERT_CHUNK) {
    await tx.insert(obligationReminders).values(skipped.slice(start, start + INSERT_CHUNK));
  }
  for (const row of rows) {
    newEvents.push(
      obligationCreated(context.tenant, {
        obligationId: row.id,
        rosterRecordId: row.rosterRecordId,
        type: row.type,
        cycleKey: row.cycleKey,
        statementDate: row.statementDate,
        dueDate: row.dueDate,
      }),
    );
    changes.created.push(row.id);
  }

  for (const link of links) {
    await tx
      .update(filingObligations)
      .set({ personId: link.personId, ofr: link.ofr })
      .where(inArray(filingObligations.id, link.obligationIds));
    changes.personLinked.push(...link.obligationIds);
  }

  await events.recordAll(tx, newEvents);
  return changes;
}

/** Midnight of a civil date in Nairobi (UTC+3, no daylight saving). */
function startOfNairobiDay(date: CivilDate): Date {
  return new Date(`${date}T00:00:00+03:00`);
}
