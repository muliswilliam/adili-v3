import type { ReactNode } from 'react';

import type { Viewer } from '../../server/viewer';
import { IdentityCard } from '../identity-card';
import { DeclarantCard, DeclarantUnavailableCard } from './account-card';

/**
 * The dashboard's cards: the declarant's obligations (spec 04, FE-2) next to their account once
 * onboarded (spec 03, FE-6), or next to the sign-in identity for someone who is not. The
 * obligations render nothing for someone who is not a declarant, so the account card then
 * takes the wide column on its own.
 */
export function DashboardCards({
  viewer,
  obligations,
}: {
  viewer: Viewer;
  /** The obligations section (`ObligationsSection`). */
  obligations: ReactNode;
}) {
  const { declarant } = viewer;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
      {obligations}
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
