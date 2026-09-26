import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { StepPending } from '../../components/onboarding/step-pending';

export const Route = createFileRoute('/get-started/confirm')({
  loader: () => requireStep('/get-started/confirm'),
  component: Confirm,
});

function Confirm() {
  return <StepPending title="Confirm your details" guard={Route.useLoaderData()} />;
}
