import { readFileSync } from 'node:fs';

import type { Database } from '@adili/data-access';
import { sql } from 'drizzle-orm';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

/** The committed migrations' tags, in journal order. */
export function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', MIGRATIONS), 'utf8')) as {
    entries: { tag: string }[];
  };
  return journal.entries.map((entry) => entry.tag);
}

/**
 * Applies the committed migrations `tags` (all of them by default) in order, in one transaction
 * as drizzle's migrator does (a migration's transaction-local settings, e.g. `app.tenant` for a
 * backfill under FORCE row-level security, hold for its later statements), in the schema the
 * connection's search path names: a suite's private schema. `after` runs last in the same
 * transaction, to see what the migrations left set in it.
 */
export async function applyMigrations<T = void>(
  db: Database<Record<string, unknown>>,
  tags: readonly string[] = migrationTags(),
  after?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    for (const tag of tags) {
      // drizzle-kit qualifies foreign key targets with "public"; resolve them in the test schema.
      const migration = readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8').replaceAll(
        '"public".',
        '',
      );
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
    }
    return after?.(tx);
  });
}
