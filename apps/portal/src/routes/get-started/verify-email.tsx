import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { VerifyStep } from '../../components/onboarding/verify-step';

export const Route = createFileRoute('/get-started/verify-email')({
  loader: () => requireStep('/get-started/verify-email'),
  component: VerifyEmail,
});

function VerifyEmail() {
  return (
    <VerifyStep channel="email" route="/get-started/verify-email" guard={Route.useLoaderData()} />
  );
}
