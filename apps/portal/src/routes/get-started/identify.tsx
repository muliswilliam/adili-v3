import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { CommissionsUnavailable } from '../../components/onboarding/commission-step';
import { redirectIfInProgress } from '../../components/onboarding/guard';
import { IdentifyStep } from '../../components/onboarding/identify-step';
import { StepHeading } from '../../components/onboarding/onboarding-layout';
import { getOnboardingCommissions, getOnboardingSession } from '../../server/onboarding';

export const Route = createFileRoute('/get-started/identify')({
  validateSearch: z.object({
    /** The Commission chosen on step 1. */
    commission: z.string().optional(),
  }),
  staticData: { onboardingStep: 2, onboardingBack: true },
  head: () => ({ meta: [{ title: 'Identify yourself · Adili Online' }] }),
  loaderDeps: ({ search }) => ({ commission: search.commission }),
  loader: async ({ deps }) => {
    const [lookup, commissions] = await Promise.all([
      getOnboardingSession(),
      getOnboardingCommissions(),
    ]);
    redirectIfInProgress(lookup);
    if (!commissions) return { commission: null };
    const commission = commissions.find((entry) => entry.slug === deps.commission);
    // Without a Commission that has a roster there is nothing to match against: choose again.
    if (!commission?.hasRoster) {
      throw redirect({ to: '/get-started', search: { commission: commission?.slug } });
    }
    return { commission };
  },
  component: Identify,
});

function Identify() {
  const { commission } = Route.useLoaderData();
  if (!commission) {
    return (
      <>
        <StepHeading title="Identify yourself" />
        <CommissionsUnavailable />
      </>
    );
  }
  return <IdentifyStep commission={commission} />;
}
