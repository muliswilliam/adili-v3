import { readdirSync, readFileSync } from 'node:fs';

import { and, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  allocate,
  allocateReference,
  DCB,
  DCF,
  DCI,
  declarationSchemes,
  defineScheme,
  issuerCode,
  numberingCounters,
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
    const scheme = testScheme('INC', { issuer: true, period: true });
    const next = (parts: { issuer?: string; period?: number }) =>
      db.transaction((tx) => allocate(tx, scheme, parts));

    expect(await next({ issuer: 'PSC', period: 2027 })).toBe(1);
    expect(await next({ issuer: 'PSC', period: 2027 })).toBe(2);
    expect(await next({ issuer: 'TSC', period: 2027 })).toBe(1);
    expect(await next({ issuer: 'PSC', period: 2028 })).toBe(1);
    expect(await next({ issuer: 'PSC', period: 2027 })).toBe(3);
  });

  it('20 concurrent allocators produce 1,000 consecutive numbers without gaps or duplicates', async () => {
    const scheme = testScheme('CCY');
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
    const scheme = testScheme('RBK');
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

describe('S18: declaration schemes', () => {
  it('keeps one counter per (scheme, issuer, year)', async () => {
    const issue = (type: keyof typeof declarationSchemes, tenant: string, year: number) =>
      db.transaction((tx) =>
        allocateReference(tx, declarationSchemes[type], {
          issuer: issuerCode(tenant),
          period: year,
        }),
      );

    expect(await issue('biennial', 'tsc', 2027)).toBe('DCB-TSC-2027-0000001-B');
    expect(await issue('biennial', 'tsc', 2027)).toBe('DCB-TSC-2027-0000002-9');
    expect(await issue('initial', 'tsc', 2027)).toBe('DCI-TSC-2027-0000001-S');
    expect(await issue('final', 'tsc', 2027)).toBe('DCF-TSC-2027-0000001-Y');
    expect(await issue('biennial', 'psc', 2027)).toBe('DCB-PSC-2027-0000001-1');
    expect(parse(await issue('biennial', 'tsc', 2029))).toMatchObject({
      period: 2029,
      sequence: 1,
    });

    const counters = await db
      .select()
      .from(numberingCounters)
      .where(
        and(
          inArray(numberingCounters.scheme, ['DCI', 'DCB', 'DCF']),
          inArray(numberingCounters.issuer, ['TSC', 'PSC']),
        ),
      )
      .orderBy(numberingCounters.scheme, numberingCounters.issuer, numberingCounters.period);
    expect(counters).toEqual([
      { scheme: 'DCB', issuer: 'PSC', period: 2027, value: 1 },
      { scheme: 'DCB', issuer: 'TSC', period: 2027, value: 2 },
      { scheme: 'DCB', issuer: 'TSC', period: 2029, value: 1 },
      { scheme: 'DCF', issuer: 'TSC', period: 2027, value: 1 },
      { scheme: 'DCI', issuer: 'TSC', period: 2027, value: 1 },
    ]);
  });

  it('gives concurrent submissions of one Commission and year consecutive references', async () => {
    const key = { issuer: issuerCode('npsc'), period: 2027 };
    // A parallel burst for another scheme and year of the same issuer must not interleave.
    const others = Array.from({ length: 10 }, () =>
      db.transaction((tx) => allocateReference(tx, DCI, { ...key, period: 2028 })),
    );
    const submissions = Array.from({ length: 200 }, () =>
      db.transaction(async (tx) => {
        const reference = await allocateReference(tx, DCB, key);
        // Hold the counter lock like a submit transaction writing its version rows.
        await tx.execute(sql`select pg_sleep(0.002)`);
        return reference;
      }),
    );

    const references = await Promise.all(submissions);
    const sequences = references
      .map((reference) => parse(reference))
      .map((parsed) => {
        expect(parsed).toMatchObject({ scheme: 'DCB', issuer: 'NPSC', period: 2027 });
        return parsed.sequence;
      })
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
    const otherSequences = (await Promise.all(others)).map(
      (reference) => parse(reference).sequence,
    );
    expect(otherSequences.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
  });

  it('returns the number when the submit transaction rolls back after allocating', async () => {
    const key = { issuer: issuerCode('jsc'), period: 2028 };
    expect(await db.transaction((tx) => allocateReference(tx, DCF, key))).toBe(
      'DCF-JSC-2028-0000001-M',
    );

    await expect(
      db.transaction(async (tx) => {
        expect(await allocateReference(tx, DCF, key)).toMatch(/^DCF-JSC-2028-0000002-/);
        throw new Error('version insert failed');
      }),
    ).rejects.toThrow('version insert failed');

    expect(parse(await db.transaction((tx) => allocateReference(tx, DCF, key)))).toMatchObject({
      sequence: 2,
    });
  });
});

function testScheme(code: string, { issuer = false, period = false } = {}) {
  return defineScheme({
    code,
    name: `Test scheme ${code}`,
    description: 'Only in tests.',
    legalBasis: 'None',
    issuer,
    period,
    periodName: period ? 'Year' : undefined,
    sequenceDigits: 7,
  });
}

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
