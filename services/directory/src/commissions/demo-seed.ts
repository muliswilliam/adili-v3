import { type Database, withTenant } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import type { DirectorySchema } from '../db/schema.js';
import { PLATFORM_TENANT } from './access.js';
import { PLATFORM_DEFAULT_POLICY } from './policy.js';
import { createPolicyVersion, nairobiToday, readCurrentPolicy } from './policy-versions.js';
import { commissionCategories, commissions, tenantPolicyVersions } from './schema.js';

/** The tenants the demo accounts in the Keycloak realm import belong to. */
export const DEMO_COMMISSIONS = [
  {
    slug: 'psc',
    name: 'Public Service Commission',
    type: 'hosted',
    categories: ['act-s32-5', 'regs-r5-e', 'regs-r5-f'],
  },
  {
    slug: 'tsc',
    name: 'Teachers Service Commission',
    type: 'hosted',
    categories: ['act-s32-10'],
  },
  {
    slug: 'eacc',
    name: 'Ethics and Anti-Corruption Commission',
    type: 'hosted',
    categories: ['regs-r5-a'],
  },
] as const;

const SEEDED_BY = 'system:demo-seed';

/**
 * Creates the demo Commissions with policy version 1. Idempotent: existing rows are left as
 * they are, so it is safe to run on every `pnpm db:seed`.
 */
export async function seedDemoCommissions(db: Database<DirectorySchema>): Promise<void> {
  await withTenant(db, { tenant: PLATFORM_TENANT, subject: SEEDED_BY }, async (tx) => {
    for (const demo of DEMO_COMMISSIONS) {
      await tx
        .insert(commissions)
        .values({ slug: demo.slug, name: demo.name, type: demo.type, createdBy: SEEDED_BY })
        .onConflictDoNothing({ target: commissions.slug });
      const [commission] = await tx
        .select({ id: commissions.id })
        .from(commissions)
        .where(eq(commissions.slug, demo.slug));
      if (!commission) {
        throw new Error(`Demo Commission ${demo.slug} is missing after insert`);
      }
      await tx
        .insert(commissionCategories)
        .values(
          demo.categories.map((categoryCode) => ({ commissionId: commission.id, categoryCode })),
        )
        .onConflictDoNothing();
      await tx
        .insert(tenantPolicyVersions)
        .values({
          tenant: demo.slug,
          version: 1,
          policy: PLATFORM_DEFAULT_POLICY,
          obligationsStartDate: nairobiToday,
          createdBy: SEEDED_BY,
        })
        .onConflictDoNothing({
          target: [tenantPolicyVersions.tenant, tenantPolicyVersions.version],
        });
    }
  });
}

/**
 * For the local reminder demo (#92): puts a policy version with `reminderOffsetsDays` in force for
 * a demo Commission, the rest copied from the current one, and announces it
 * (`directory.policy.changed.v1`) so the declarations service pulls it. Obligations created from
 * then on are reminded at those offsets, e.g. 29 days before the due date for an officer appointed
 * yesterday (an initial due in 29 days), so the reminder goes out today. Changes nothing when the
 * offsets are in force already. Never run against real data: the product changes the
 * obligations-start date only (spec 04).
 */
export async function useDemoReminderOffsets(
  db: Database<DirectorySchema>,
  events: EventPublisher,
  { tenant, reminderOffsetsDays }: { tenant: string; reminderOffsetsDays: number[] },
): Promise<void> {
  await withTenant(db, { tenant: PLATFORM_TENANT, subject: SEEDED_BY }, async (tx) => {
    const current = await readCurrentPolicy(tx, tenant);
    if (sameOffsets(current.reminderOffsetsDays, reminderOffsetsDays)) return;
    await createPolicyVersion(tx, events, {
      tenant,
      obligationsStartDate: current.obligationsStartDate,
      effectiveFrom: new Date(),
      createdBy: SEEDED_BY,
      createdByName: 'Reminder demo',
      reminderOffsetsDays,
    });
  });
}

function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((days, index) => days === b[index]);
}
