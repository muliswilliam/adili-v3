import { readFileSync } from 'node:fs';

import { createDatabase } from '@adili/data-access';
import { sql } from 'drizzle-orm';

/**
 * A private Postgres schema with the events tables, for one run of a suite: runs overlap (other
 * suites, other checkouts) on the shared test database, so each gets its own tables.
 */
export interface PrivateSchema {
  /** `TEST_DATABASE_URL` with the schema as search path. */
  url: string;
  /** Creates the schema afresh and applies the committed migrations. */
  create(): Promise<void>;
  drop(): Promise<void>;
}

export function privateSchema(name: string, applicationName: string): PrivateSchema {
  const url = withSearchPath(requireEnv('TEST_DATABASE_URL'), name);
  const run = async (statements: string[]) => {
    const setup = createDatabase({ url, schema: {}, applicationName });
    try {
      for (const statement of statements) await setup.execute(sql.raw(statement));
    } finally {
      await setup.$client.end();
    }
  };
  return {
    url,
    async create() {
      const statements = [`drop schema if exists ${name} cascade; create schema ${name}`];
      const migrations = new URL('../migrations/', import.meta.url);
      const journal = JSON.parse(
        readFileSync(new URL('meta/_journal.json', migrations), 'utf8'),
      ) as { entries: { tag: string }[] };
      for (const { tag } of journal.entries) {
        const migration = readFileSync(new URL(`${tag}.sql`, migrations), 'utf8');
        statements.push(
          ...migration.split('--> statement-breakpoint').filter((statement) => statement.trim()),
        );
      }
      await run(statements);
    },
    drop: () => run([`drop schema if exists ${name} cascade`]),
  };
}

/** Eight random lowercase letters, to keep a run's schema, queues and event types apart. */
export function runId(): string {
  return Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}

function withSearchPath(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}
