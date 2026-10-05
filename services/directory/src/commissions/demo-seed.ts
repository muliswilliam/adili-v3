import { PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, withTenant } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import type { DirectorySchema } from '../db/schema.js';
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

/** What a demo policy version changes; anything left out keeps the current version's value. */
export interface DemoPolicy {
  tenant: string;
  reminderOffsetsDays?: number[];
  obligationsStartDate?: string;
  /** Biennial statement and due month-days, e.g. `{ statementDate: '06-30', dueDate: '12-31' }`. */
  biennial?: { statementDate: string; dueDate: string };
}

/**
 * For the demos: puts a policy version in force for a Commission with the reminder offsets,
 * obligations-start date and biennial month-days given, the rest copied from the current one, and
 * announces it (`directory.policy.changed.v1`) so the declarations service pulls it. Changes
 * nothing when all of them are in force already, so it is safe to run again.
 *
 * - The local reminder demo (#92) shortens the offsets, e.g. 29 days before the due date for an
 *   officer appointed yesterday (an initial due in 29 days), so the reminder goes out today.
 * - The demo seed (#617) moves the biennial statement date so its demo cycles have passed their
 *   statement date, and the start date back so the cycles reach the officers.
 *
 * `obligationsStartDate` must not be after a demo officer's appointment, or no initial is owed.
 * Never run against real data: the product changes the obligations-start date only (spec 04).
 */
export async function useDemoPolicy(
  db: Database<DirectorySchema>,
  events: EventPublisher,
  { tenant, reminderOffsetsDays, obligationsStartDate, biennial }: DemoPolicy,
): Promise<boolean> {
  return withTenant(db, { tenant: PLATFORM_TENANT, subject: SEEDED_BY }, async (tx) => {
    const current = await readCurrentPolicy(tx, tenant);
    const startDate = obligationsStartDate ?? current.obligationsStartDate;
    const offsetsInForce =
      !reminderOffsetsDays || sameOffsets(current.reminderOffsetsDays, reminderOffsetsDays);
    const biennialInForce =
      !biennial ||
      (current.biennial.statementDate === biennial.statementDate &&
        current.biennial.dueDate === biennial.dueDate);
    if (offsetsInForce && biennialInForce && startDate === current.obligationsStartDate) {
      return false;
    }
    await createPolicyVersion(tx, events, {
      tenant,
      obligationsStartDate: startDate,
      effectiveFrom: new Date(),
      createdBy: SEEDED_BY,
      createdByName: 'Demo policy',
      ...(reminderOffsetsDays && { reminderOffsetsDays }),
      ...(biennial && { biennial }),
    });
    return true;
  });
}

/** The local reminder demo (#92): `useDemoPolicy` with short reminder offsets. */
export async function useDemoReminderOffsets(
  db: Database<DirectorySchema>,
  events: EventPublisher,
  options: { tenant: string; reminderOffsetsDays: number[]; obligationsStartDate?: string },
): Promise<void> {
  await useDemoPolicy(db, events, options);
}

function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((days, index) => days === b[index]);
}
