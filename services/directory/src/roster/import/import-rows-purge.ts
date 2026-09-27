import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';

import { PLATFORM_TENANT } from '../../commissions/access.js';
import type { DirectorySchema } from '../../db/schema.js';
import { rosterImportRows, rosterImports } from '../schema.js';

/** Staged rows (the report) are kept this long after their import ends (spec #27). */
export const IMPORT_ROWS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** When the rows of an import that ended at `completedAt` are purged; null while it runs. */
export function rowsRetainedUntil(completedAt: Date | null): Date | null {
  return completedAt && new Date(completedAt.getTime() + IMPORT_ROWS_RETENTION_MS);
}

/** Whether the rows of an import that ended at `completedAt` are past their retention. */
export function rowsExpired(completedAt: Date | null, now = new Date()): boolean {
  const until = rowsRetainedUntil(completedAt);
  return until !== null && until <= now;
}

export interface PurgeOptions {
  now?: Date;
  /** Rows deleted per statement, each in its own transaction. */
  batchSize?: number;
}

/**
 * Deletes the staged rows of every import that ended more than 30 days before `now`, in
 * batches so a 436,000-row import does not hold one long transaction. Imports themselves (the
 * history, with their counts) are kept. Idempotent; returns the number of rows deleted.
 */
export async function purgeExpiredImportRows(
  db: Database<DirectorySchema>,
  { now = new Date(), batchSize = 10_000 }: PurgeOptions = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - IMPORT_ROWS_RETENTION_MS);
  let purged = 0;
  for (;;) {
    const result = await withTenant(db, { tenant: PLATFORM_TENANT, subject: PURGE_SUBJECT }, (tx) =>
      tx.execute(sql`
        delete from ${rosterImportRows}
        where (${rosterImportRows.importId}, ${rosterImportRows.rowNumber}) in (
          select rows.import_id, rows.row_number
          from ${rosterImportRows} rows
          join ${rosterImports} imports on imports.id = rows.import_id
          where imports.completed_at < ${cutoff.toISOString()}
          limit ${batchSize}
        )`),
    );
    const deleted = result.rowCount ?? 0;
    purged += deleted;
    if (deleted < batchSize) return purged;
  }
}

/** `app.subject` of the purge's transactions. */
const PURGE_SUBJECT = 'roster-import-rows-purge';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Purges expired import rows hourly (the api-kit idempotency janitor's pattern, spec #27
 * decision 24). Every replica runs it; the delete is idempotent.
 */
@Injectable()
export class ImportRowsJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ImportRowsJanitor.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      purgeExpiredImportRows(this.db).then(
        (purged) => {
          if (purged > 0) this.logger.log(`Purged ${purged} roster import rows past retention`);
        },
        (error: unknown) => {
          this.logger.warn({ err: error }, 'Purging expired roster import rows failed');
        },
      );
    }, PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}
