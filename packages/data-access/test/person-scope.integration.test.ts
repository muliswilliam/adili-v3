import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, withPerson, withTenant } from '../src/index.js';

/**
 * Person-scoped row-level security (spec 04): declarant data is keyed by person, not tenant. A
 * sample table carries both policies the declarations tables use (ADR-006): tenant isolation for
 * staff transactions and a person policy for declarant reads. The test role owns the table, so
 * FORCE applies the policies to it as it does to a service's own role.
 */
const DATABASE_URL = requireEnv('TEST_DATABASE_URL');
const SCHEMA = `person_scope_test_${process.pid}`;

// One connection, so a setting leaking past a transaction would show on the next query.
const db = createDatabase({
  url: `${DATABASE_URL}${DATABASE_URL.includes('?') ? '&' : '?'}options=-c%20search_path%3D${SCHEMA}`,
  schema: {},
  applicationName: 'data-access-person-scope-test',
  maxConnections: 1,
});

const wanjiru = randomUUID();
const otieno = randomUUID();

interface Row extends Record<string, unknown> {
  id: string;
}

beforeAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`));
  await db.execute(
    sql.raw(`
      create table obligations (
        id text primary key,
        tenant text not null,
        person_id uuid
      );
      alter table obligations enable row level security;
      alter table obligations force row level security;
      create policy obligations_tenant_isolation on obligations
        using (tenant = current_setting('app.tenant', true))
        with check (tenant = current_setting('app.tenant', true));
      create policy obligations_person_read on obligations for select
        using (person_id = nullif(current_setting('app.person', true), '')::uuid);
    `),
  );
  // Wanjiru has an obligation with PSC and one with TSC; Otieno one with PSC; one PSC officer
  // has not onboarded yet (no person).
  for (const [id, tenant, personId] of [
    ['psc-wanjiru', 'psc', wanjiru],
    ['tsc-wanjiru', 'tsc', wanjiru],
    ['psc-otieno', 'psc', otieno],
    ['psc-unlinked', 'psc', null],
  ] as const) {
    await withTenant(db, { tenant, subject: 'test' }, (tx) =>
      tx.execute(sql`insert into obligations values (${id}, ${tenant}, ${personId})`),
    );
  }
});

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade`));
  await db.$client.end();
});

const visibleTo = (personId: string) =>
  withPerson(db, { personId, subject: 'declarant' }, async (tx) => {
    const { rows } = await tx.execute<Row>(sql`select id from obligations order by id`);
    return rows.map((row) => row.id);
  });

describe('withPerson', () => {
  it("admits the caller's own rows across Commissions and no one else's", async () => {
    expect(await visibleTo(wanjiru)).toEqual(['psc-wanjiru', 'tsc-wanjiru']);
    expect(await visibleTo(otieno)).toEqual(['psc-otieno']);
    expect(await visibleTo(randomUUID())).toEqual([]);
  });

  it('sets app.person and app.subject for the transaction and resets them on commit', async () => {
    const inside = await withPerson(db, { personId: wanjiru, subject: 'declarant' }, async (tx) => {
      const { rows } = await tx.execute<{ person: string; subject: string }>(
        sql`select current_setting('app.person', true) as person, current_setting('app.subject', true) as subject`,
      );
      return rows[0];
    });
    const { rows: after } = await db.execute<{ person: string | null }>(
      sql`select nullif(current_setting('app.person', true), '') as person`,
    );

    expect(inside).toEqual({ person: wanjiru, subject: 'declarant' });
    expect(after).toEqual([{ person: null }]);
    const { rows: outside } = await db.execute<Row>(sql`select id from obligations`);
    expect(outside).toEqual([]);
  });

  it('resets app.person when the work fails and the transaction rolls back', async () => {
    await expect(
      withPerson(db, { personId: wanjiru, subject: 'declarant' }, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
    const { rows } = await db.execute<Row>(sql`select id from obligations`);

    expect(rows).toEqual([]);
  });

  it('lets a declarant read but not write, even rows of their own', async () => {
    await expect(
      withPerson(db, { personId: wanjiru, subject: 'declarant' }, (tx) =>
        tx.execute(sql`insert into obligations values ('psc-forged', 'psc', ${wanjiru})`),
      ),
    ).rejects.toThrow();
    const updated = await withPerson(db, { personId: wanjiru, subject: 'declarant' }, (tx) =>
      tx.execute(sql`update obligations set tenant = 'tsc' where id = 'psc-wanjiru'`),
    );

    expect(updated.rowCount).toBe(0);
  });

  it('leaves staff transactions tenant-scoped, without the person rows of other tenants', async () => {
    const psc = await withTenant(db, { tenant: 'psc', subject: 'officer' }, async (tx) => {
      const { rows } = await tx.execute<Row>(sql`select id from obligations order by id`);
      return rows.map((row) => row.id);
    });

    expect(psc).toEqual(['psc-otieno', 'psc-unlinked', 'psc-wanjiru']);
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see vitest.integration.config.ts)`);
  return value;
}
