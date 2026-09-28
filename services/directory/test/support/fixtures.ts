import { randomUUID } from 'node:crypto';

import { type Database, withTenant } from '@adili/data-access';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { PLATFORM_DEFAULT_POLICY } from '../../src/commissions/policy.js';
import {
  commissionCategories,
  commissions,
  type DirectorySchema,
  reportingOfficerAssignments,
  rosterApiCredentials,
  tenantPolicyVersions,
} from '../../src/db/schema.js';

/**
 * Arranges Commissions directly in the database until the create and assign endpoints exist
 * (#14, #17); switch these to HTTP calls then.
 */
export interface CommissionFixture {
  slug: string;
  name: string;
  type?: 'hosted' | 'federated';
  categories?: string[];
  officer?: { state: 'invited' | 'activated'; name?: string; keycloakUserId?: string };
}

export async function givenCommissions(
  db: Database<DirectorySchema>,
  fixtures: CommissionFixture[],
): Promise<void> {
  await withTenant(db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    for (const fixture of fixtures) {
      const [commission] = await tx
        .insert(commissions)
        .values({
          slug: fixture.slug,
          name: fixture.name,
          type: fixture.type ?? 'hosted',
          createdBy: 'test',
        })
        .returning({ id: commissions.id });
      if (!commission) throw new Error('insert returned no row');
      if (fixture.categories?.length) {
        await tx.insert(commissionCategories).values(
          fixture.categories.map((categoryCode) => ({
            commissionId: commission.id,
            categoryCode,
          })),
        );
      }
      await tx.insert(tenantPolicyVersions).values({
        tenant: fixture.slug,
        version: 1,
        policy: PLATFORM_DEFAULT_POLICY,
        createdBy: 'test',
      });
      if (fixture.officer) {
        const invitedAt = new Date('2026-09-20T09:00:00Z');
        await tx.insert(reportingOfficerAssignments).values({
          commissionId: commission.id,
          tenant: fixture.slug,
          name: fixture.officer.name ?? `Officer of ${fixture.slug}`,
          email: `officer@${fixture.slug}.go.ke`,
          phone: '+254712345678',
          keycloakUserId: fixture.officer.keycloakUserId ?? randomUUID(),
          state: fixture.officer.state,
          invitedAt,
          activatedAt:
            fixture.officer.state === 'activated' ? new Date('2026-09-21T10:30:00Z') : null,
          createdBy: 'test',
        });
      }
    }
  });
}

export interface ApiCredentialFixture {
  tenant: string;
  /** The credential's client id: `azp` of the HR system's tokens. */
  clientId: string;
  rotatedAt?: Date;
  revokedAt?: Date;
}

/**
 * Arranges a Commission's HR-system credential as the credential endpoints leave it, so tokens
 * with its client id and the Commission's tenant are accepted (or refused once rotated or
 * revoked after they were issued).
 */
export async function givenApiCredential(
  db: Database<DirectorySchema>,
  fixture: ApiCredentialFixture,
): Promise<void> {
  await withTenant(db, { tenant: fixture.tenant, subject: 'test' }, (tx) =>
    tx.insert(rosterApiCredentials).values({
      tenant: fixture.tenant,
      keycloakClientId: fixture.clientId,
      createdBy: 'officer',
      rotatedAt: fixture.rotatedAt ?? null,
      revokedAt: fixture.revokedAt ?? null,
    }),
  );
}
