import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { StepPending } from '../../components/onboarding/step-pending';

export const Route = createFileRoute('/get-started/verify-email')({
  loader: () => requireStep('/get-started/verify-email'),
  component: VerifyEmail,
});

function VerifyEmail() {
  return <StepPending title="Verify your email" guard={Route.useLoaderData()} />;
}
