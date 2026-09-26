import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { StepPending } from '../../components/onboarding/step-pending';

export const Route = createFileRoute('/get-started/done')({
  loader: () => requireStep('/get-started/done'),
  component: Done,
});

function Done() {
  return <StepPending title="Your account is ready" guard={Route.useLoaderData()} />;
}
