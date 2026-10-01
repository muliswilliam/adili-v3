import { withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cycleOpenings, tenantPolicyCache } from '../../src/db/schema.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';

/**
 * ADR-006 §5.3: every table with rows about one tenant is under FORCE row-level security. The
 * policy cache and the cycle openings are read by tenant transactions (staff summaries, the
 * Commission's cycle opening) and by platform work (national summary, start-up schedules).
 */
let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

const policy = {
  version: 1,
  obligationsStartDate: '2026-01-01',
  initialDueAfterAppointmentDays: 30,
  biennial: { statementDate: '11-01', dueDate: '12-31' },
  finalDueAfterExitDays: 30,
  reminderOffsetsDays: [30, 14, 7],
};

beforeEach(async () => {
  await api.reset();
  await withTenant(api.db, { tenant: 'platform', subject: 'test' }, async (tx) => {
    for (const tenant of ['psc', 'tsc']) {
      await tx.insert(tenantPolicyCache).values({
        tenant,
        policyVersionId: crypto.randomUUID(),
        version: 1,
        policy,
      });
      await tx.insert(cycleOpenings).values({ tenant, cycleYear: 2027, obligationsCreated: 3 });
    }
  });
});

describe.each([
  ['tenant_policy_cache', tenantPolicyCache],
  ['cycle_openings', cycleOpenings],
] as const)('%s', (_name, table) => {
  it("shows a tenant's transaction only its own rows, platform work every tenant's", async () => {
    const psc = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select({ tenant: table.tenant }).from(table),
    );
    const platform = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select({ tenant: table.tenant }).from(table),
    );

    expect(psc.map((row) => row.tenant)).toEqual(['psc']);
    expect(platform.map((row) => row.tenant).sort()).toEqual(['psc', 'tsc']);
  });

  it('shows a transaction without a tenant nothing', async () => {
    const rows = await api.db.select({ tenant: table.tenant }).from(table);

    expect(rows).toEqual([]);
  });

  it("refuses a tenant's transaction a write for another tenant", async () => {
    const write = withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.execute(sql`update ${table} set tenant = 'kra' where tenant = 'psc'`),
    );

    await expect(write).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/row-level security/) as unknown },
    });
  });
});
