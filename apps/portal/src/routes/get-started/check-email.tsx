import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { CheckEmailStep } from '../../components/onboarding/outcome-steps';

export const Route = createFileRoute('/get-started/check-email')({
  loader: () => requireStep('/get-started/check-email'),
  component: CheckEmail,
});

function CheckEmail() {
  return <CheckEmailStep guard={Route.useLoaderData()} />;
}
