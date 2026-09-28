import { randomUUID } from 'node:crypto';

import { createDatabase, type Database } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, migrationTags } from '../support/migrations.js';

/**
 * Spec 04 S19: the migration that gives policy versions an obligations-start date back-fills the
 * versions of existing Commissions with the date each Commission was created (Africa/Nairobi),
 * so officers appointed before a Commission joined Adili get no initial obligation.
 */

const MIGRATION = '0024_policy_start_date_roster_exits';

let db: Database<Record<string, unknown>>;
let pgSchema: string;

beforeAll(async () => {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) throw new Error('TEST_DATABASE_URL is required; see vitest.integration.config.ts');
  pgSchema = `directory_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'directory-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();
  db = createDatabase({ url: url.toString(), schema: {}, applicationName: 'directory-test' });
});

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
  await db.$client.end();
});

describe(`migration ${MIGRATION}`, () => {
  it("back-fills every existing version with its Commission's creation date in Nairobi", async () => {
    const tags = migrationTags();
    const index = tags.indexOf(MIGRATION);
    expect(index).toBeGreaterThan(0);
    await applyMigrations(db, tags.slice(0, index));
    // 22:30 UTC is 01:30 the next day in Nairobi.
    await db.execute(sql`
      insert into commissions (slug, name, type, created_by, created_at)
      values ('psc', 'Public Service Commission', 'hosted', 'test', '2026-03-01T22:30:00Z'),
             ('tsc', 'Teachers Service Commission', 'hosted', 'test', '2026-05-10T06:00:00Z')
    `);
    await db.execute(sql`
      insert into tenant_policy_versions (tenant, version, policy, created_by)
      select slug, 1, '{"initialDueAfterAppointmentDays": 30}'::jsonb, 'test' from commissions
    `);

    await applyMigrations(db, tags.slice(index));

    const rows = await db.execute<{ tenant: string; start: string }>(sql`
      select tenant, obligations_start_date::text as start
      from tenant_policy_versions order by tenant
    `);
    expect(rows.rows).toEqual([
      { tenant: 'psc', start: '2026-03-02' },
      { tenant: 'tsc', start: '2026-05-10' },
    ]);
  });
});
