import { and, eq } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { commissions } from '../../commissions/schema.js';
import { rosterSummaries } from '../../roster/schema.js';
import type { OnboardingCommission } from '../representation.js';

/**
 * Commissions as the onboarding flow shows them (`OnboardingCommission`): slug, issuer code,
 * name, and whether a roster was imported. The one query behind the public list, identify's
 * check and the sessions' view.
 */
export function selectOnboardingCommissions(tx: Transaction) {
  return tx
    .select({
      slug: commissions.slug,
      name: commissions.name,
      lastImportId: rosterSummaries.lastImportId,
    })
    .from(commissions)
    .leftJoin(rosterSummaries, eq(rosterSummaries.tenant, commissions.slug));
}

export function toOnboardingCommission(row: {
  slug: string;
  name: string;
  lastImportId: string | null;
}): OnboardingCommission {
  return {
    slug: row.slug,
    issuerCode: row.slug.toUpperCase(),
    name: row.name,
    hasRoster: row.lastImportId !== null,
  };
}

/** The active Commission `slug`, or undefined (unknown, or not active). */
export async function findActiveCommission(
  tx: Transaction,
  slug: string,
): Promise<OnboardingCommission | undefined> {
  const [row] = await selectOnboardingCommissions(tx).where(
    and(eq(commissions.slug, slug), eq(commissions.status, 'active')),
  );
  return row && toOnboardingCommission(row);
}

/** The Commission of a session, which exists as long as its session does. */
export async function commissionOfSession(
  tx: Transaction,
  session: { id: string; tenant: string },
): Promise<OnboardingCommission> {
  const [row] = await selectOnboardingCommissions(tx).where(eq(commissions.slug, session.tenant));
  if (!row) throw new Error(`Commission ${session.tenant} of session ${session.id} is gone`);
  return toOnboardingCommission(row);
}
