import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { commissions, reportingOfficerAssignments } from '../../src/db/schema.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/**
 * The database's own guarantees on reporting officer assignments, below the API: rows are
 * isolated by tenant (row-level security), at most one assignment per Commission is not
 * `replaced`, and timestamps and `replaced_by` agree with the state. The API never reaches these
 * (it scopes by tenant, locks the Commission and replaces before inserting), so they are
 * exercised with direct writes.
 */
type NewAssignment = typeof reportingOfficerAssignments.$inferInsert;

let api: DirectoryApi;
let commissionId: string;
let otherCommissionId: string;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'psc', name: 'Public Service Commission' },
  ]);
  const ids = new Map(
    (await api.db.select({ id: commissions.id, slug: commissions.slug }).from(commissions)).map(
      ({ id, slug }) => [slug, id],
    ),
  );
  commissionId = ids.get('tsc') ?? '';
  otherCommissionId = ids.get('psc') ?? '';
});

const assignment = (overrides: Partial<NewAssignment> = {}): NewAssignment => ({
  commissionId,
  tenant: 'tsc',
  name: 'Fatuma Wanjiru',
  email: `${randomUUID()}@tsc.go.ke`,
  phone: '+254712345678',
  keycloakUserId: randomUUID(),
  state: 'invited',
  invitedAt: new Date(),
  createdBy: 'test',
  ...overrides,
});

const insert = (...rows: NewAssignment[]) =>
  withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    const ids: string[] = [];
    for (const row of rows) {
      const [inserted] = await tx
        .insert(reportingOfficerAssignments)
        .values(row)
        .returning({ id: reportingOfficerAssignments.id });
      ids.push(inserted?.id ?? '');
    }
    return ids;
  });

/** A Postgres error field of a failed write, looking through Drizzle's error wrapper. */
async function pgErrorField(
  write: Promise<unknown>,
  field: 'constraint' | 'code',
): Promise<string | undefined> {
  const error = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    const value: unknown = (cause as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** The constraint a failed write violated. */
const violatedConstraint = (write: Promise<unknown>) => pgErrorField(write, 'constraint');

/** SQLSTATE of a write refused by a row-level security policy. */
const RLS_VIOLATION = '42501';

describe('tenant isolation (row-level security)', () => {
  const asTsc = { tenant: 'tsc', subject: 'test' };
  let tscId: string;
  let pscId: string;

  beforeEach(async () => {
    [tscId = '', pscId = ''] = await insert(
      assignment(),
      assignment({ commissionId: otherCommissionId, tenant: 'psc', email: 'officer@psc.go.ke' }),
    );
  });

  // Superusers and BYPASSRLS roles skip every policy, even under FORCE, so the tests below would
  // pass vacuously. Services connect as their database's owning role, which FORCE binds.
  it('runs as a role that row-level security applies to', async () => {
    const { rows } = await api.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );

    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it("reads only the tenant's own assignments", async () => {
    const rows = await withTenant(api.db, asTsc, (tx) =>
      tx.select({ id: reportingOfficerAssignments.id }).from(reportingOfficerAssignments),
    );

    expect(rows).toEqual([{ id: tscId }]);
  });

  it('reads no assignments without a tenant context', async () => {
    const rows = await api.db
      .select({ id: reportingOfficerAssignments.id })
      .from(reportingOfficerAssignments);

    expect(rows).toEqual([]);
  });

  it("refuses to insert another tenant's assignment", async () => {
    const write = withTenant(api.db, asTsc, (tx) =>
      tx.insert(reportingOfficerAssignments).values(
        assignment({
          commissionId: otherCommissionId,
          tenant: 'psc',
          state: 'replaced',
          replacedAt: new Date(),
        }),
      ),
    );

    expect(await pgErrorField(write, 'code')).toBe(RLS_VIOLATION);
  });

  it("refuses to move the tenant's assignment to another tenant", async () => {
    const write = withTenant(api.db, asTsc, (tx) =>
      tx
        .update(reportingOfficerAssignments)
        .set({ tenant: 'psc' })
        .where(eq(reportingOfficerAssignments.id, tscId)),
    );

    expect(await pgErrorField(write, 'code')).toBe(RLS_VIOLATION);
  });

  it("cannot update or delete another tenant's assignment", async () => {
    const touched = await withTenant(api.db, asTsc, async (tx) => ({
      updated: await tx
        .update(reportingOfficerAssignments)
        .set({ name: 'Mallory' })
        .where(eq(reportingOfficerAssignments.id, pscId))
        .returning({ id: reportingOfficerAssignments.id }),
      deleted: await tx
        .delete(reportingOfficerAssignments)
        .where(eq(reportingOfficerAssignments.id, pscId))
        .returning({ id: reportingOfficerAssignments.id }),
    }));

    expect(touched).toEqual({ updated: [], deleted: [] });
    const pscRows = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select({ name: reportingOfficerAssignments.name }).from(reportingOfficerAssignments),
    );
    expect(pscRows).toEqual([{ name: 'Fatuma Wanjiru' }]);
  });
});

describe('at most one current assignment per Commission', () => {
  it.each([
    ['invited', 'invited'],
    ['invited', 'activated'],
    ['activated', 'activated'],
  ] as const)('refuses a second non-replaced assignment (%s, %s)', async (first, second) => {
    const activatedAt = new Date();
    const rows = [first, second].map((state) =>
      assignment({ state, activatedAt: state === 'activated' ? activatedAt : null }),
    );

    expect(await violatedConstraint(insert(...rows))).toBe(
      'reporting_officer_assignments_current_key',
    );
  });

  it('accepts any number of replaced assignments beside the current one', async () => {
    const ids = await insert(
      assignment({ state: 'replaced', replacedAt: new Date() }),
      assignment({ state: 'replaced', replacedAt: new Date() }),
      assignment(),
    );

    expect(ids).toHaveLength(3);
  });

  it('refuses to make a replaced assignment current again while another is', async () => {
    const [replaced] = await insert(
      assignment({ state: 'replaced', replacedAt: new Date() }),
      assignment(),
    );

    const revive = withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx
        .update(reportingOfficerAssignments)
        .set({ state: 'invited', replacedAt: null })
        .where(eq(reportingOfficerAssignments.id, replaced ?? '')),
    );

    expect(await violatedConstraint(revive)).toBe('reporting_officer_assignments_current_key');
  });
});

describe('state and timestamps agree', () => {
  it('refuses a replaced assignment without replaced_at', async () => {
    expect(await violatedConstraint(insert(assignment({ state: 'replaced' })))).toBe(
      'reporting_officer_assignments_replaced_at_check',
    );
  });

  it('refuses replaced_at on an assignment that is not replaced', async () => {
    expect(await violatedConstraint(insert(assignment({ replacedAt: new Date() })))).toBe(
      'reporting_officer_assignments_replaced_at_check',
    );
  });

  it('refuses an activated assignment without activated_at', async () => {
    expect(await violatedConstraint(insert(assignment({ state: 'activated' })))).toBe(
      'reporting_officer_assignments_activated_at_check',
    );
  });

  it('refuses replaced_by on an assignment that is not replaced', async () => {
    const [current] = await insert(assignment({ state: 'replaced', replacedAt: new Date() }));

    expect(await violatedConstraint(insert(assignment({ replacedBy: current ?? '' })))).toBe(
      'reporting_officer_assignments_replaced_by_check',
    );
  });

  it('refuses an assignment replaced by itself', async () => {
    const id = randomUUID();

    const write = insert(
      assignment({ id, state: 'replaced', replacedAt: new Date(), replacedBy: id }),
    );

    expect(await violatedConstraint(write)).toBe('reporting_officer_assignments_replaced_by_check');
  });
});
