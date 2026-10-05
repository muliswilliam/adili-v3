import { notFoundIfInvisible } from '@adili/api-kit';
import type { EventPublisher } from '@adili/events';
import { desc, eq, sql } from 'drizzle-orm';

import type { Transaction } from './commissions.service.js';
import { policyChanged } from './events.js';
import { withPolicyDefaults } from './policy.js';
import type { TenantPolicyHistory, TenantPolicyVersion } from './policy-representation.js';
import { commissions, tenantPolicyVersions } from './schema.js';

/**
 * A Commission's policy versions (spec 04): reading the one in force and the history, and
 * creating a version. Versions are never changed; the highest number is in force. Each runs in
 * the caller's transaction; the caller has decided the Commission is theirs to see.
 */

/** Today in Africa/Nairobi as the database sees it: version 1's obligations-start date. */
export const nairobiToday = sql<string>`(now() at time zone 'Africa/Nairobi')::date`;

type VersionRow = typeof tenantPolicyVersions.$inferSelect;

/** The version in force; 404 when the Commission has none (it does not exist). */
export async function readCurrentPolicy(
  tx: Transaction,
  tenant: string,
): Promise<TenantPolicyVersion> {
  return toTenantPolicyVersion(await currentVersion(tx, tenant));
}

async function currentVersion(tx: Transaction, tenant: string): Promise<VersionRow> {
  const [current] = await tx
    .select()
    .from(tenantPolicyVersions)
    .where(eq(tenantPolicyVersions.tenant, tenant))
    .orderBy(desc(tenantPolicyVersions.version))
    .limit(1);
  return notFoundIfInvisible(current);
}

/** The version in force and the earlier ones, newest first; 404 when there are none. */
export async function readPolicyHistory(
  tx: Transaction,
  tenant: string,
): Promise<TenantPolicyHistory> {
  const [current, ...previous] = await tx
    .select()
    .from(tenantPolicyVersions)
    .where(eq(tenantPolicyVersions.tenant, tenant))
    .orderBy(desc(tenantPolicyVersions.version));
  return {
    current: toTenantPolicyVersion(notFoundIfInvisible(current)),
    previous: previous.map(toTenantPolicyVersion),
  };
}

export interface CreatePolicyVersion {
  tenant: string;
  obligationsStartDate: string;
  effectiveFrom: Date;
  /** Who creates it: the token's `sub` and display name. */
  createdBy: string;
  createdByName: string | null;
  /**
   * Replaces the reminder offsets. Only the local reminder demo sets it (`useDemoReminderOffsets`):
   * the product changes the obligations-start date alone (spec 04).
   */
  reminderOffsetsDays?: number[];
  /**
   * Replaces the biennial statement and due month-days. Only the demo seed sets it
   * (`useDemoPolicy`), to run its demo cycles on dates that have passed.
   */
  biennial?: { statementDate: string; dueDate: string };
}

/**
 * Puts a new version in force: the current one's periods, reminders and windows with the new
 * obligations-start date, numbered one on. Records `directory.policy.changed.v1`. 404 when the
 * Commission does not exist. Concurrent changes of one Commission queue on its row, so each gets
 * its own number.
 */
export async function createPolicyVersion(
  tx: Transaction,
  events: EventPublisher,
  command: CreatePolicyVersion,
): Promise<TenantPolicyVersion> {
  const [commission] = await tx
    .select({ slug: commissions.slug })
    .from(commissions)
    .where(eq(commissions.slug, command.tenant))
    .for('update');
  notFoundIfInvisible(commission);
  const current = await currentVersion(tx, command.tenant);
  const [created] = await tx
    .insert(tenantPolicyVersions)
    .values({
      tenant: command.tenant,
      version: current.version + 1,
      effectiveFrom: command.effectiveFrom,
      policy: {
        ...withPolicyDefaults(current.policy),
        ...(command.reminderOffsetsDays && { reminderOffsetsDays: command.reminderOffsetsDays }),
        ...(command.biennial && { biennial: command.biennial }),
      },
      obligationsStartDate: command.obligationsStartDate,
      createdBy: command.createdBy,
      createdByName: command.createdByName,
    })
    .returning();
  if (!created) throw new Error('Policy version insert returned no row');
  await events.record(
    tx,
    policyChanged(command.tenant, { policyVersionId: created.id, version: created.version }),
  );
  return toTenantPolicyVersion(created);
}

function toTenantPolicyVersion(row: VersionRow): TenantPolicyVersion {
  const policy = withPolicyDefaults(row.policy);
  return {
    id: row.id,
    version: row.version,
    effectiveFrom: row.effectiveFrom.toISOString(),
    obligationsStartDate: row.obligationsStartDate,
    initialDueAfterAppointmentDays: policy.initialDueAfterAppointmentDays,
    biennial: policy.biennial,
    finalDueAfterExitDays: policy.finalDueAfterExitDays,
    reminderOffsetsDays: policy.reminderOffsetsDays,
    clarification: policy.clarification,
    formMDue: policy.formMDue,
    access: policy.access,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}
