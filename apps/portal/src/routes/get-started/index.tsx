import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { CommissionStep } from '../../components/onboarding/commission-step';
import { routeForSession } from '../../components/onboarding/steps';
import { getOnboardingCommissions, getOnboardingSession } from '../../server/onboarding';

export const Route = createFileRoute('/get-started/')({
  validateSearch: z.object({
    /** Preselects a Commission, e.g. from a link a reporting officer shared, or from Back. */
    commission: z.string().optional(),
    /** Why the declarant is starting again. */
    notice: z.enum(['ended', 'too-many']).optional(),
  }),
  staticData: { onboardingStep: 1 },
  head: () => ({ meta: [{ title: 'Choose your Commission · Adili Online' }] }),
  loader: async () => {
    const [lookup, commissions] = await Promise.all([
      getOnboardingSession(),
      getOnboardingCommissions(),
    ]);
    if (lookup.status === 'active') {
      const target = routeForSession(lookup.session);
      if (target !== '/get-started') throw redirect({ to: target });
    }
    return { commissions };
  },
  component: ChooseCommission,
});

function ChooseCommission() {
  const { commissions } = Route.useLoaderData();
  const { commission, notice } = Route.useSearch();
  return <CommissionStep commissions={commissions} preselected={commission} notice={notice} />;
}
