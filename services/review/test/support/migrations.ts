import { readFileSync } from 'node:fs';

import type { Database } from '@adili/data-access';
import { sql } from 'drizzle-orm';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

/** The committed migrations' tags, in the order drizzle applies them. */
export function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', MIGRATIONS), 'utf8')) as {
    entries: { tag: string }[];
  };
  return journal.entries.map(({ tag }) => tag);
}

/** A migration's statements, resolved in the connection's schema. */
export function migrationStatements(tag: string): string[] {
  // drizzle-kit qualifies foreign key targets with "public"; resolve them in the test schema.
  const migration = readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8').replaceAll(
    '"public".',
    '',
  );
  return migration.split('--> statement-breakpoint').filter((statement) => statement.trim());
}

/**
 * Applies the committed migrations in one transaction, as drizzle's migrator does: a
 * `set_config(..., true)` in one lasts to the end of the run. `from` (included) and `until`
 * (excluded) apply a part of them, to seed rows a later migration backfills.
 */
export async function applyMigrations<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  { from, until }: { from?: string; until?: string } = {},
): Promise<void> {
  const tags = migrationTags();
  const start = from === undefined ? 0 : tags.indexOf(from);
  const end = until === undefined ? tags.length : tags.indexOf(until);
  if (start < 0 || end < 0) throw new Error(`No migration ${String(start < 0 ? from : until)}`);
  await db.transaction(async (tx) => {
    for (const tag of tags.slice(start, end)) {
      for (const statement of migrationStatements(tag)) await tx.execute(sql.raw(statement));
    }
  });
}
