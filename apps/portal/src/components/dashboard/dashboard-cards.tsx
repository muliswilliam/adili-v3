import type { Viewer } from '../../server/viewer';
import { IdentityCard } from '../identity-card';
import { DeclarantCard, DeclarantUnavailableCard, NotDeclarantCard } from './account-card';
import { type DashboardWork, ObligationsCard } from './obligations-card';

/**
 * The dashboard's cards. An onboarded declarant sees their obligations, with Start declaration,
 * next to their account; someone who is not a declarant sees why, next to their sign-in
 * identity.
 */
export function DashboardCards({ viewer, work }: { viewer: Viewer; work?: DashboardWork | null }) {
  const { declarant } = viewer;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {declarant.status === 'not-declarant' ? (
        <>
          <NotDeclarantCard />
          <IdentityCard user={viewer.user} directory={viewer.directory} />
        </>
      ) : (
        <>
          <ObligationsCard work={work} />
          {declarant.status === 'onboarded' ? (
            <DeclarantCard account={declarant.account} />
          ) : (
            <DeclarantUnavailableCard />
          )}
        </>
      )}
    </div>
  );
}
