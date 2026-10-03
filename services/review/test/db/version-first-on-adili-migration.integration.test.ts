import { randomUUID } from 'node:crypto';

import { createDatabase, type Database, withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../support/migrations.js';

const MIGRATION = '0017_version_first_on_adili';

interface Version {
  caseId: string;
  versionId: string;
  version: number;
  submittedAt: string;
}

/**
 * 0017's backfill of `review_case_versions.first_on_adili` over rows written before it, applied as
 * the service applies it: by the tables' owner, under FORCE row-level security, with no tenant set.
 */
describe(`migration ${MIGRATION}`, () => {
  const baseUrl = process.env.TEST_DATABASE_URL ?? '';
  const pgSchema = `review_migration_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
  let db: Database;
  const personId = randomUUID();
  let first: Version;
  let amendedFirst: Version;
  let amendment: Version;
  let later: Version;

  beforeAll(async () => {
    const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'review-test' });
    await admin.execute(sql.raw(`create schema ${pgSchema}`));
    await admin.$client.end();
    const url = new URL(baseUrl);
    url.searchParams.set('options', `-c search_path=${pgSchema}`);
    db = createDatabase({ url: url.toString(), schema: {}, applicationName: 'review-test' });
    await applyMigrations(db, { until: MIGRATION });

    // A first declaration whose no-previous-version flag is still on its case.
    first = await givenCase({ personId: randomUUID(), submittedAt: '2027-12-01T08:00:00Z' });
    await givenFlag(first, 'no-previous-version');
    // A person's first declaration, amended: the amendment replaced version 1's unreviewed flags.
    amendedFirst = await givenCase({ personId, submittedAt: '2027-12-02T08:00:00Z' });
    amendment = await givenVersion(amendedFirst.caseId, 2, '2027-12-20T08:00:00Z');
    // The same person's next declaration, compared with the first.
    later = await givenCase({ personId, submittedAt: '2029-12-02T08:00:00Z' });

    await applyMigrations(db, { from: MIGRATION });
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'review-test' });
    try {
      await admin.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
    } finally {
      await admin.$client.end();
    }
  });

  it('marks a version first on Adili when its no-previous-version flag is on the case', async () => {
    expect(await firstOnAdili(first)).toBe(true);
  });

  it("marks a person's earliest version 1 first on Adili once an amendment took its flag", async () => {
    expect(await firstOnAdili(amendedFirst)).toBe(true);
    expect(await firstOnAdili(amendment)).toBe(false);
  });

  it('leaves a version with an earlier declaration to compare with as it was', async () => {
    expect(await firstOnAdili(later)).toBe(false);
  });

  async function givenCase({
    personId,
    submittedAt,
  }: {
    personId: string;
    submittedAt: string;
  }): Promise<Version> {
    const caseId = randomUUID();
    const versionId = randomUUID();
    await asPsc(
      sql`insert into review_cases (id, tenant, declaration_id, current_version_id, current_version,
        person_id, reference, type, statement_date, cycle_year, received_at, window_ends_at, late,
        score, band, status, declarant_name, personnel_file_number)
      values (${caseId}, 'psc', ${randomUUID()}, ${versionId}, 1, ${personId}, 'DEC-PSC-2027-0000009-2',
        'biennial', '2027-11-01', 2027, ${submittedAt}, ${submittedAt}, false, 0, 'low', 'unassigned',
        'Achieng Otieno', 'PF-1')`,
    );
    return givenVersion(caseId, 1, submittedAt, versionId);
  }

  async function givenVersion(
    caseId: string,
    version: number,
    submittedAt: string,
    versionId: string = randomUUID(),
  ): Promise<Version> {
    await asPsc(
      sql`insert into review_case_versions (id, tenant, case_id, version_id, version, submitted_at, late, amendment)
      values (${randomUUID()}, 'psc', ${caseId}, ${versionId}, ${version}, ${submittedAt}, false, ${version > 1})`,
    );
    return { caseId, versionId, version, submittedAt };
  }

  async function givenFlag({ caseId, versionId }: Version, ruleId: string): Promise<void> {
    await asPsc(
      sql`insert into review_flags (id, tenant, case_id, version_id, rule_id, severity, title, indicator, evidence, item_refs)
      values (${randomUUID()}, 'psc', ${caseId}, ${versionId}, ${ruleId}, 'info', 'First declaration',
        'Nothing to compare with.', '{}', '[]')`,
    );
  }

  async function firstOnAdili({ caseId, version }: Version): Promise<boolean> {
    const { rows } = await withTenant(db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.execute<{ first_on_adili: boolean }>(
        sql`select first_on_adili from review_case_versions where case_id = ${caseId} and version = ${version}`,
      ),
    );
    if (!rows[0]) throw new Error('No such version');
    return rows[0].first_on_adili;
  }

  function asPsc(statement: ReturnType<typeof sql>) {
    return withTenant(db, { tenant: 'psc', subject: 'test' }, (tx) => tx.execute(statement));
  }
});
