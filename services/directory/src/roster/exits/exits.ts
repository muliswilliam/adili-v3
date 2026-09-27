import { randomUUID } from 'node:crypto';

import type { EventPublisher } from '@adili/events';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import type { RosterActor } from '../actor.js';
import { rosterRecords } from '../schema.js';
import { refreshRosterSummary } from '../summary.js';
import { type ExitSource, rosterExitsConfirmed, rosterRecordsKept } from './events.js';

/**
 * Exits and keeps on a Commission's roster (spec #27): the domain operations behind the console's
 * confirm-exits and keep endpoints and the HR systems' explicit exit (#56). Each runs in the
 * caller's transaction, in the tenant's RLS context, and changes the records, the summary and
 * the event together.
 */

/** Some records are not on the tenant's roster. */
export class RosterRecordsNotFound extends Error {
  constructor(readonly recordIds: readonly string[]) {
    super(`Roster records not found: ${recordIds.join(', ')}`);
    this.name = 'RosterRecordsNotFound';
  }
}

/** Some records have exited already. */
export class RosterRecordsExited extends Error {
  constructor(readonly recordIds: readonly string[]) {
    super(`Roster records already exited: ${recordIds.join(', ')}`);
    this.name = 'RosterRecordsExited';
  }
}

export interface ConfirmExits {
  tenant: string;
  /** Each record at most once, with its exit date (`YYYY-MM-DD`, validated by the caller). */
  exits: readonly { recordId: string; exitDate: string }[];
  source: ExitSource;
  actor: RosterActor;
}

/**
 * Exits the records: `exited` with their exit date, the absent flag cleared, and the actor
 * stamped as who resolved them. An exited record stays on the roster (for the final declaration)
 * but no longer counts as expected. HR-system exits also make `api` the record's source.
 * All or nothing: throws `RosterRecordsNotFound` or `RosterRecordsExited` naming the offending
 * records, and changes nothing. Records `roster.exits.confirmed.v1`.
 */
export async function confirmExits(
  tx: Transaction,
  events: EventPublisher,
  command: ConfirmExits,
): Promise<{ batchId: string; count: number }> {
  const recordIds = command.exits.map((exit) => exit.recordId);
  const found = await lockRecords(tx, command.tenant, recordIds);
  const exited = recordIds.filter((id) => found.get(id) === 'exited');
  if (exited.length > 0) throw new RosterRecordsExited(exited);

  const source = command.exits.map((exit) => ({ id: exit.recordId, exit_date: exit.exitDate }));
  await tx.execute(sql`
    update roster_records as target set
      state = 'exited',
      exit_date = source.exit_date,
      absent_from_latest_import = false,
      flagged_by_import_id = null,
      flagged_at = null,
      flag_cleared_by = ${command.actor.id},
      flag_cleared_at = now(),
      source = ${command.source === 'api' ? sql`'api'` : sql`target.source`},
      updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(source)}::jsonb) as source(id uuid, exit_date date)
    where target.id = source.id and target.tenant = ${command.tenant}
  `);
  await refreshRosterSummary(tx, command.tenant);

  const batchId = randomUUID();
  await events.record(
    tx,
    rosterExitsConfirmed(command.tenant, {
      batchId,
      count: recordIds.length,
      source: command.source,
      recordIds,
      actor: { kind: command.actor.kind, id: command.actor.id },
    }),
  );
  return { batchId, count: recordIds.length };
}

export interface KeepRecords {
  tenant: string;
  recordIds: readonly string[];
  actor: RosterActor;
}

/**
 * Keeps the records whose officers are still employed: clears their absent flag and stamps the
 * actor as who resolved them. Records that are not flagged (or have exited) are left as they
 * are and not counted. Throws `RosterRecordsNotFound`, changing nothing, when any record is not
 * on the roster. Records `roster.records.kept.v1` when it cleared any flag.
 */
export async function keepRecords(
  tx: Transaction,
  events: EventPublisher,
  command: KeepRecords,
): Promise<{ count: number }> {
  await lockRecords(tx, command.tenant, command.recordIds);
  const kept = await tx
    .update(rosterRecords)
    .set({
      absentFromLatestImport: false,
      flaggedByImportId: null,
      flaggedAt: null,
      flagClearedBy: command.actor.id,
      flagClearedAt: sql`now()`,
    })
    .where(
      and(
        eq(rosterRecords.tenant, command.tenant),
        inArray(rosterRecords.id, [...command.recordIds]),
        eq(rosterRecords.absentFromLatestImport, true),
      ),
    )
    .returning({ id: rosterRecords.id });
  if (kept.length === 0) return { count: 0 };

  await refreshRosterSummary(tx, command.tenant);
  await events.record(
    tx,
    rosterRecordsKept(command.tenant, {
      count: kept.length,
      recordIds: kept.map((record) => record.id),
      actor: { kind: command.actor.kind, id: command.actor.id },
    }),
  );
  return { count: kept.length };
}

/**
 * Locks the tenant's records with these ids until the commit and returns their states by id;
 * throws `RosterRecordsNotFound` for ids not on the roster.
 */
async function lockRecords(
  tx: Transaction,
  tenant: string,
  recordIds: readonly string[],
): Promise<Map<string, typeof rosterRecords.$inferSelect.state>> {
  const rows = await tx
    .select({ id: rosterRecords.id, state: rosterRecords.state })
    .from(rosterRecords)
    .where(and(eq(rosterRecords.tenant, tenant), inArray(rosterRecords.id, [...recordIds])))
    .orderBy(rosterRecords.id)
    .for('update');
  const states = new Map(rows.map((row) => [row.id, row.state]));
  const missing = recordIds.filter((id) => !states.has(id));
  if (missing.length > 0) throw new RosterRecordsNotFound(missing);
  return states;
}
