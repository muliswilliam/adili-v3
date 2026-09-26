import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { StepPending } from '../../components/onboarding/step-pending';

export const Route = createFileRoute('/get-started/check-email')({
  loader: () => requireStep('/get-started/check-email'),
  component: CheckEmail,
});

function CheckEmail() {
  return <StepPending title="Check your email" guard={Route.useLoaderData()} />;
}
