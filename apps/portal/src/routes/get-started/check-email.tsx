import { createFileRoute } from '@tanstack/react-router';

import { requireCheckEmail } from '../../components/onboarding/guard';
import { CheckEmailStep } from '../../components/onboarding/outcome-steps';

export const Route = createFileRoute('/get-started/check-email')({
  staticData: { onboardingStep: 6 },
  head: () => ({ meta: [{ title: 'Check your email · Adili Online' }] }),
  loader: () => requireCheckEmail(),
  component: CheckEmail,
});

function CheckEmail() {
  return <CheckEmailStep guard={Route.useLoaderData()} />;
}
