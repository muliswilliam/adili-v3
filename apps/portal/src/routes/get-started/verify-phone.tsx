import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { StepPending } from '../../components/onboarding/step-pending';

export const Route = createFileRoute('/get-started/verify-phone')({
  loader: () => requireStep('/get-started/verify-phone'),
  component: VerifyPhone,
});

function VerifyPhone() {
  return <StepPending title="Verify your phone" guard={Route.useLoaderData()} />;
}
