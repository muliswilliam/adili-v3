import { randomUUID } from 'node:crypto';

import { createDatabase, type Database } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, migrationTags } from '../support/migrations.js';

/**
 * Spec 10 decision 1: a package issued before grants recorded what they delivered is an access
 * package. The tables are under FORCE row-level security, so the backfill must run as platform
 * work: run with no tenant it sees no row (0009's did, hence 0010).
 */

const MIGRATION = '0010_backfill_package_kind';

let db: Database<Record<string, unknown>>;
let pgSchema: string;

beforeAll(async () => {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) throw new Error('TEST_DATABASE_URL is required; see vitest.integration.config.ts');
  pgSchema = `access_test_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'access-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();
  db = createDatabase({ url: url.toString(), schema: {}, applicationName: 'access-test' });
});

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
  await db.$client.end();
});

describe(`migration ${MIGRATION}`, () => {
  it('marks the packages issued before it as access packages, in every Commission, as platform work it ends', async () => {
    const tags = migrationTags();
    const index = tags.indexOf(MIGRATION);
    expect(index).toBeGreaterThan(0);
    await applyMigrations(db, tags.slice(0, index));
    // Issued packages, and a request with none, recorded as the service does: in their
    // Commission's context.
    for (const [tenant, packaged] of [
      ['psc', true],
      ['tsc', true],
      ['psc', false],
    ] as const) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant', ${tenant}, true)`);
        await tx.execute(sql`
          insert into access_requests (
            id, tenant, commission_name, reference, applicant_subject, applicant_person_id,
            applicant_name, applicant_identity_status, form_k_ciphertext, form_k_envelope,
            officer_sought, scope, status, submitted_at, decision_deadline_at, package_document_id
          ) values (
            ${randomUUID()}, ${tenant}, 'Commission', ${`ARQ-${randomUUID()}`}, 'applicant',
            ${randomUUID()}, 'Applicant', 'verified', 'x', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
            ${packaged ? 'granted' : 'denied'}, now(), now(), ${packaged ? randomUUID() : null}
          )
        `);
      });
    }

    // Run in one transaction with the migrations after it, as drizzle's migrator does: it must
    // not leave them working as platform.
    const tenantAfter = await applyMigrations(db, tags.slice(index, index + 1), async (tx) => {
      const setting = await tx.execute<{ tenant: string | null }>(
        sql`select current_setting('app.tenant', true) as tenant`,
      );
      return setting.rows[0]?.tenant ?? '';
    });
    expect(tenantAfter).toBe('');

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant', 'platform', true)`);
      return tx.execute<{ tenant: string; kind: string | null }>(sql`
        select tenant, package_kind as kind from access_requests order by tenant, kind
      `);
    });
    expect(rows.rows).toEqual([
      { tenant: 'psc', kind: 'access-package' },
      { tenant: 'psc', kind: null },
      { tenant: 'tsc', kind: 'access-package' },
    ]);
  });
});
