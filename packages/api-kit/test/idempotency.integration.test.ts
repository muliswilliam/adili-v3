import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { idempotencyKeys, PostgresIdempotencyStore } from '../src/index.js';
import { calls, describeIdempotency } from './idempotency.scenarios.js';

/**
 * Runs the HTTP contract against the real `idempotency_keys` table (`pnpm infra:up`).
 * Uses a private Postgres schema so it can share the test database with other suites.
 */
const DATABASE_URL = requireEnv('TEST_DATABASE_URL');
const SCHEMA = `idempotency_test_${process.pid}`;

const pool = new pg.Pool({ connectionString: DATABASE_URL, options: `-c search_path=${SCHEMA}` });
const db: NodePgDatabase = drizzle({ client: pool, casing: 'snake_case' });
const store = new PostgresIdempotencyStore(db, { claimTimeoutMs: 1_000 });

beforeAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`));
  const migration = readFileSync(
    new URL('migrations/0000_idempotency.sql', import.meta.url),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint')) {
    await db.execute(sql.raw(statement));
  }
});

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade`));
  await pool.end();
});

describeIdempotency(
  'the Postgres store',
  () => store,
  (harness) => {
    it('forgets keys after 24 hours', async () => {
      const key = randomUUID();
      await harness().send({ url: '/v1/things', key, body: { name: 'Pen' } });
      await ageKey(key, '25 hours');

      const later = await harness().send({ url: '/v1/things', key, body: { name: 'Pencil' } });

      expect(later.statusCode).toBe(201);
      expect(later.headers['idempotent-replayed']).toBeUndefined();
      expect(calls.create).toBe(2);
    });

    it('lets a retry take over a claim abandoned mid-request', async () => {
      const key = randomUUID();
      await db.insert(idempotencyKeys).values({
        key,
        principalSubject: 'admin-1',
        requestHash: 'from-a-crashed-process',
        createdAt: sql`now() - interval '2 seconds'`,
      });

      const retry = await harness().send({ url: '/v1/things', key, body: { name: 'Pen' } });

      expect(retry.statusCode).toBe(201);
      expect(calls.create).toBe(1);
    });

    it('returns the body with its original key order', async () => {
      const key = randomUUID();
      const first = await harness().send({ url: '/v1/things', key, body: { name: 'A long name' } });
      const retry = await harness().send({ url: '/v1/things', key, body: { name: 'A long name' } });

      expect(retry.body).toBe(first.body);
    });
  },
);

describe('PostgresIdempotencyStore', () => {
  it('grants a key to exactly one of many concurrent claims', async () => {
    const scope = { key: randomUUID(), subject: 'admin-1' };

    const claims = await Promise.all(
      Array.from({ length: 10 }, () => store.claim(scope, 'same-request')),
    );

    expect(claims.filter((claim) => claim.outcome === 'claimed')).toHaveLength(1);
  });

  it('purges keys older than 24 hours and keeps recent ones', async () => {
    const [old, recent] = [randomUUID(), randomUUID()];
    await store.claim({ key: old, subject: 'admin-1' }, 'hash');
    await store.claim({ key: recent, subject: 'admin-1' }, 'hash');
    await ageKey(old, '25 hours');

    expect(await store.purgeExpired()).toBeGreaterThanOrEqual(1);

    const remaining = await db.select({ key: idempotencyKeys.key }).from(idempotencyKeys);
    const keys = remaining.map((row) => row.key);
    expect(keys).toContain(recent);
    expect(keys).not.toContain(old);
  });
});

async function ageKey(key: string, age: string): Promise<void> {
  await db.execute(
    sql`update ${idempotencyKeys} set created_at = now() - ${age}::interval where key = ${key}`,
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
