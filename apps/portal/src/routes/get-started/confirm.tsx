import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { ConfirmStep } from '../../components/onboarding/confirm-step';

export const Route = createFileRoute('/get-started/confirm')({
  loader: () => requireStep('/get-started/confirm'),
  component: Confirm,
});

function Confirm() {
  return <ConfirmStep guard={Route.useLoaderData()} />;
}
