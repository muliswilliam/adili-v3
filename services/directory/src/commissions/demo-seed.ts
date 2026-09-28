import type { Database } from '@adili/data-access';
import { eq } from 'drizzle-orm';

import type { DirectorySchema } from '../db/schema.js';
import { PLATFORM_DEFAULT_POLICY } from './policy.js';
import { nairobiToday } from './policy-versions.js';
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
  await db.transaction(async (tx) => {
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
