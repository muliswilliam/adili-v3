import { Card, CardContent, CardDescription, CardHeader, CardTitle, Icon } from '@adili/ui';
import { Calendar03Icon } from '@hugeicons/core-free-icons';

import type { Viewer } from '../../server/viewer';
import { IdentityCard } from '../identity-card';
import { DeclarantCard, DeclarantUnavailableCard } from './account-card';

/**
 * The dashboard's cards: the obligations placeholder (spec 01's copy; obligations arrive in
 * slice 04) next to the declarant's account once onboarded (spec 03, FE-6), or next to the
 * sign-in identity for someone who is not.
 */
export function DashboardCards({ viewer }: { viewer: Viewer }) {
  const { declarant } = viewer;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <ObligationsCard />
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

/** Spec 01's placeholder; obligations arrive in slice 04. */
function ObligationsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Filing obligations</CardTitle>
        <CardDescription>Declarations you are required to file.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <Icon icon={Calendar03Icon} className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No obligations yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Obligations appear here when a declaration falls due under your Commission's roster.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
