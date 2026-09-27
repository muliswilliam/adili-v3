import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { CommissionStep } from '../../components/onboarding/commission-step';
import { resumeRoute } from '../../components/onboarding/steps';
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
    // A session in progress resumes; a finished one does not hold the declarant on its page.
    const resume = lookup.status === 'active' ? resumeRoute(lookup.session) : null;
    if (resume) throw redirect({ to: resume });
    return { commissions };
  },
  component: ChooseCommission,
});

function ChooseCommission() {
  const { commissions } = Route.useLoaderData();
  const { commission, notice } = Route.useSearch();
  return <CommissionStep commissions={commissions} preselected={commission} notice={notice} />;
}
