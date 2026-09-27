import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { VerifyStep } from '../../components/onboarding/verify-step';

export const Route = createFileRoute('/get-started/verify-phone')({
  staticData: { onboardingStep: 4 },
  head: () => ({ meta: [{ title: 'Verify your phone · Adili Online' }] }),
  loader: () => requireStep('/get-started/verify-phone'),
  component: VerifyPhone,
});

function VerifyPhone() {
  return (
    <VerifyStep channel="phone" route="/get-started/verify-phone" guard={Route.useLoaderData()} />
  );
}
