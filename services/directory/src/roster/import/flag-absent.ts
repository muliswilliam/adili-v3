import { type Database, withTenant } from '@adili/data-access';
import { and, count, eq, ne, sql } from 'drizzle-orm';

import type { DirectorySchema } from '../../db/schema.js';
import { rosterImports, rosterRecords } from '../schema.js';
import { adjustRosterSummary } from '../summary.js';
import { IMPORT_SUBJECT } from './staging.js';
import type { ImportRef } from './workflow-contract.js';

/**
 * The flag-absent step of a declared-complete import (spec #27), in one transaction: flags the
 * tenant's records that are not exited and that the import did not see (no row in the file,
 * accepted or rejected), as flagged by this import; clears the flag of records it saw. Records
 * flagged by an earlier import and still absent move to this one, so the flag always names the
 * latest complete import. Moves the roster summary's flagged count by what changed. Returns how
 * many records this import flagged.
 *
 * Idempotent: a re-run flags and clears nothing more and returns the same count. An import that
 * is not processing, or not declared complete, is left alone and flags nobody.
 */
export async function flagAbsent(db: Database<DirectorySchema>, ref: ImportRef): Promise<number> {
  return withTenant(db, { tenant: ref.tenant, subject: IMPORT_SUBJECT }, async (tx) => {
    const [current] = await tx
      .select({ state: rosterImports.state, declaredComplete: rosterImports.declaredComplete })
      .from(rosterImports)
      .where(and(eq(rosterImports.id, ref.importId), eq(rosterImports.tenant, ref.tenant)))
      .for('update');
    if (current?.state !== 'processing' || !current.declaredComplete) return 0;

    // The records both updates change, locked in id order first, as everywhere records are locked,
    // with how the updates move the summary's flagged count: records flagged that were not yet
    // (a flag moving from an earlier import counts already), less those cleared that counted.
    const { rows: moved } = await tx.execute<{ flagging: number; clearing: number }>(sql`
      select
        count(*) filter (where flagging and not absent_from_latest_import)::int as flagging,
        count(*) filter (where not flagging and state <> 'exited')::int as clearing
      from (
        select
          state,
          absent_from_latest_import,
          (state <> 'exited'
            and last_seen_import_id <> ${ref.importId}
            and flagged_by_import_id is distinct from ${ref.importId}) as flagging
        from roster_records
        where tenant = ${ref.tenant}
          and (
            (state <> 'exited'
              and last_seen_import_id <> ${ref.importId}
              and flagged_by_import_id is distinct from ${ref.importId})
            or (last_seen_import_id = ${ref.importId} and absent_from_latest_import)
          )
        order by id
        for update
      ) as locked
    `);
    await tx.execute(sql`
      update roster_records set
        absent_from_latest_import = true,
        flagged_by_import_id = ${ref.importId},
        flagged_at = now(),
        flag_cleared_by = null,
        flag_cleared_at = null,
        updated_at = now()
      where tenant = ${ref.tenant}
        and state <> 'exited'
        and last_seen_import_id <> ${ref.importId}
        and flagged_by_import_id is distinct from ${ref.importId}
    `);
    await tx.execute(sql`
      update roster_records set
        absent_from_latest_import = false,
        flagged_by_import_id = null,
        flagged_at = null,
        updated_at = now()
      where tenant = ${ref.tenant}
        and last_seen_import_id = ${ref.importId}
        and absent_from_latest_import
    `);
    await adjustRosterSummary(tx, ref.tenant, {
      expected: 0,
      onboarded: 0,
      flagged: (moved[0]?.flagging ?? 0) - (moved[0]?.clearing ?? 0),
    });

    const [flagged] = await tx
      .select({ records: count() })
      .from(rosterRecords)
      .where(
        and(
          eq(rosterRecords.tenant, ref.tenant),
          eq(rosterRecords.flaggedByImportId, ref.importId),
          eq(rosterRecords.absentFromLatestImport, true),
          ne(rosterRecords.state, 'exited'),
        ),
      );
    return flagged?.records ?? 0;
  });
}
