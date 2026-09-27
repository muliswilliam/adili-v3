import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { NotVerifiedStep } from '../../components/onboarding/outcome-steps';

export const Route = createFileRoute('/get-started/not-verified')({
  head: () => ({ meta: [{ title: 'Identity not verified · Adili Online' }] }),
  loader: () => requireStep('/get-started/not-verified'),
  component: NotVerified,
});

function NotVerified() {
  return <NotVerifiedStep guard={Route.useLoaderData()} />;
}
