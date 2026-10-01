import type { ReactNode } from 'react';

import type { NoticesLoad } from '../../server/access-notices';
import type { DeclarationListResult } from '../../server/declarations.server';
import type { Viewer } from '../../server/viewer';
import { AccessNoticesSection } from '../access-notices/notices-card';
import { IdentityCard } from '../identity-card';
import { DeclarantCard, DeclarantUnavailableCard } from './account-card';
import { DeclarationsSection } from './declarations-card';
import { DraftsProvider } from './drafts';

/**
 * The dashboard's cards: the declarant's declarations (spec 05) above their obligations (spec
 * 04, FE-2), next to their account once onboarded (spec 03, FE-6), or next to the sign-in
 * identity for someone who is not. The obligations render nothing for someone who is not a
 * declarant, so the account card then takes the wide column on its own. Neither waits for the
 * other: the declarations stream in (`DeclarationsSection`) and reach the obligations' Start
 * buttons through `DraftsProvider`. Requests to see the declaration (spec 10 FE-4) stream in too:
 * on top while one waits for the declarant's response, else under the obligations.
 */
export function DashboardCards({
  viewer,
  declarations,
  accessNotices = null,
  obligations,
}: {
  viewer: Viewer;
  /** An onboarded declarant's declarations, on their way; null for anyone else. */
  declarations?: Promise<DeclarationListResult> | null;
  /** An onboarded declarant's access requests, on their way; null for anyone else. */
  accessNotices?: Promise<NoticesLoad> | null;
  /** The obligations section (`ObligationsSection`). */
  obligations: ReactNode;
}) {
  const { declarant } = viewer;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
      <DraftsProvider declarations={declarations ?? null}>
        {declarations ? (
          <div className="grid content-start gap-6">
            {accessNotices ? (
              <AccessNoticesSection notices={accessNotices} placement="first" />
            ) : null}
            <DeclarationsSection declarations={declarations} />
            {obligations}
            {accessNotices ? (
              <AccessNoticesSection notices={accessNotices} placement="last" />
            ) : null}
          </div>
        ) : (
          obligations
        )}
      </DraftsProvider>
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
