import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { commissions, reportingOfficerAssignments } from '../../src/db/schema.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/**
 * The database's own guarantees on reporting officer assignments, below the API: at most one
 * assignment per Commission is not `replaced`, and timestamps and `replaced_by` agree with the
 * state. The API never reaches these (it locks the Commission and replaces before inserting), so
 * they are exercised with direct writes.
 */
type NewAssignment = typeof reportingOfficerAssignments.$inferInsert;

let api: DirectoryApi;
let commissionId: string;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [{ slug: 'tsc', name: 'Teachers Service Commission' }]);
  const [commission] = await api.db
    .select({ id: commissions.id })
    .from(commissions)
    .where(eq(commissions.slug, 'tsc'));
  commissionId = commission?.id ?? '';
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

/** The constraint a failed write violated, looking through Drizzle's error wrapper. */
async function violatedConstraint(write: Promise<unknown>): Promise<string | undefined> {
  const error = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('constraint' in cause && typeof cause.constraint === 'string') return cause.constraint;
  }
  return undefined;
}

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
