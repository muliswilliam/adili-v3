import type { Viewer } from '../../server/viewer';
import { IdentityCard } from '../identity-card';
import { DeclarantCard, DeclarantUnavailableCard } from './account-card';
import { DeclarationsCard } from './declarations-card';
import { type DashboardWork, ObligationsCard } from './obligations-card';

/**
 * The dashboard's cards: the declarant's declarations (spec 05) above the obligations card, with
 * Start declaration for an onboarded declarant and spec 01's placeholder otherwise, next to the
 * declarant's account once onboarded (spec 03, FE-6), or next to the sign-in identity for someone
 * who is not.
 */
export function DashboardCards({ viewer, work }: { viewer: Viewer; work?: DashboardWork | null }) {
  const { declarant } = viewer;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid content-start gap-6">
        {work ? <DeclarationsCard declarations={work.declarations} /> : null}
        <ObligationsCard work={work} />
      </div>
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
