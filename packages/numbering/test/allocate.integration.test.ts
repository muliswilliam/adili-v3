import { readdirSync, readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  allocate,
  allocateReference,
  defineScheme,
  numberingSchema,
  OFR,
  parse,
} from '../src/index.js';

/**
 * Runs against Postgres (`pnpm infra:up`). Each run gets its own schema so parallel runs
 * against the shared test database do not see each other's counters.
 */
const DATABASE_URL = requireEnv('TEST_DATABASE_URL');
const SCHEMA = `numbering_test_${process.pid}`;
const DCB = defineScheme({ code: 'DCB', issuer: true, period: true, sequenceDigits: 7 });

let admin: pg.Pool;
let pool: pg.Pool;
let db: NodePgDatabase<typeof numberingSchema>;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  await admin.query(`create schema ${SCHEMA}`);
  // The migration generated from the exported schema, applied inside the test schema.
  const migrations = new URL('migrations/', import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const statements = readFileSync(new URL(file, migrations), 'utf8').split(
      '--> statement-breakpoint',
    );
    for (const statement of statements) {
      await admin.query(`set search_path to ${SCHEMA}; ${statement}`);
    }
  }
  // Same casing as `createDatabase` in @adili/data-access, which services use.
  pool = new pg.Pool({ connectionString: withSearchPath(DATABASE_URL, SCHEMA), max: 25 });
  db = drizzle({ client: pool, schema: numberingSchema, casing: 'snake_case' });
});

afterAll(async () => {
  await pool.end();
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await admin.end();
});

describe('allocate', () => {
  it('only accepts a transaction', () => {
    // Checked by tsc: outside a transaction the increment would commit on its own.
    // @ts-expect-error: a database is not a transaction.
    const outsideTransaction = () => allocate(db, OFR);
    expect(outsideTransaction).toBeTypeOf('function');
  });

  it('starts at 1 and increments per (scheme, issuer, period)', async () => {
    const next = (parts: { issuer?: string; period?: number }) =>
      db.transaction((tx) => allocate(tx, DCB, parts));

    expect(await next({ issuer: 'PSC', period: 2027 })).toBe(1);
    expect(await next({ issuer: 'PSC', period: 2027 })).toBe(2);
    expect(await next({ issuer: 'TSC', period: 2027 })).toBe(1);
    expect(await next({ issuer: 'PSC', period: 2028 })).toBe(1);
    expect(await next({ issuer: 'PSC', period: 2027 })).toBe(3);
  });

  it('20 concurrent allocators produce 1,000 consecutive numbers without gaps or duplicates', async () => {
    const scheme = defineScheme({
      code: 'CCY',
      issuer: false,
      period: false,
      sequenceDigits: 7,
    });
    const perWorker = 50;
    const workers = Array.from({ length: 20 }, async () => {
      const values: number[] = [];
      for (let index = 0; index < perWorker; index++) {
        values.push(
          await db.transaction(async (tx) => {
            const value = await allocate(tx, scheme);
            // Hold the row lock briefly so transactions genuinely overlap.
            await tx.execute(sql`select pg_sleep(0.001)`);
            return value;
          }),
        );
      }
      return values;
    });

    const values = (await Promise.all(workers)).flat().sort((a, b) => a - b);

    expect(values).toEqual(Array.from({ length: 1_000 }, (_, index) => index + 1));
  });

  it('leaves no gap when the allocating transaction rolls back', async () => {
    const scheme = defineScheme({ code: 'RBK', issuer: false, period: false, sequenceDigits: 7 });
    await db.transaction((tx) => allocate(tx, scheme));

    await expect(
      db.transaction(async (tx) => {
        expect(await allocate(tx, scheme)).toBe(2);
        throw new Error('record insert failed');
      }),
    ).rejects.toThrow('record insert failed');

    expect(await db.transaction((tx) => allocate(tx, scheme))).toBe(2);
  });
});

describe('allocateReference', () => {
  it('issues a formatted OFR that parses back', async () => {
    const first = await db.transaction((tx) => allocateReference(tx, OFR));
    const second = await db.transaction((tx) => allocateReference(tx, OFR));

    expect(first).toBe('OFR-0000001-G');
    expect(parse(second)).toMatchObject({ scheme: 'OFR', sequence: 2 });
  });

  it('issues issuer and period references', async () => {
    const reference = await db.transaction((tx) =>
      allocateReference(tx, DCB, { issuer: 'EACC', period: 2027 }),
    );

    expect(parse(reference, [DCB])).toMatchObject({ issuer: 'EACC', period: 2027, sequence: 1 });
  });
});

function withSearchPath(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  return parsed.toString();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
