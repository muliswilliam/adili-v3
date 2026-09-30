import type { ReactNode } from 'react';

import type { DeclarationListResult } from '../../server/declarations.server';
import type { Viewer } from '../../server/viewer';
import { IdentityCard } from '../identity-card';
import { DeclarantCard, DeclarantUnavailableCard } from './account-card';
import { DeclarationsCard } from './declarations-card';

/**
 * The dashboard's cards: the declarant's declarations (spec 05) above their obligations (spec
 * 04, FE-2), next to their account once onboarded (spec 03, FE-6), or next to the sign-in
 * identity for someone who is not. The obligations render nothing for someone who is not a
 * declarant, so the account card then takes the wide column on its own.
 */
export function DashboardCards({
  viewer,
  declarations,
  obligations,
}: {
  viewer: Viewer;
  /** An onboarded declarant's declarations; null for anyone else. */
  declarations?: DeclarationListResult | null;
  /** The obligations section (`ObligationsSection`). */
  obligations: ReactNode;
}) {
  const { declarant } = viewer;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
      {declarations ? (
        <div className="grid content-start gap-6">
          <DeclarationsCard declarations={declarations} />
          {obligations}
        </div>
      ) : (
        obligations
      )}
      {declarant.status === 'onboarded' ? (
        <DeclarantCard account={declarant.account} />
      ) : declarant.status === 'not-declarant' ? (
        <IdentityCard user={viewer.user} directory={viewer.directory} />
      ) : (
        <DeclarantUnavailableCard />
      )}
    </div>
  );
}
