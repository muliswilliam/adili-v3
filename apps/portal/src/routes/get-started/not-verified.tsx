import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { StepPending } from '../../components/onboarding/step-pending';

export const Route = createFileRoute('/get-started/not-verified')({
  loader: () => requireStep('/get-started/not-verified'),
  component: NotVerified,
});

function NotVerified() {
  return <StepPending title="We could not verify your identity" guard={Route.useLoaderData()} />;
}
