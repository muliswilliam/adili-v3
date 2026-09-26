import { createFileRoute } from '@tanstack/react-router';

import { requireStep } from '../../components/onboarding/guard';
import { DoneStep } from '../../components/onboarding/outcome-steps';

export const Route = createFileRoute('/get-started/done')({
  loader: () => requireStep('/get-started/done'),
  component: Done,
});

function Done() {
  return <DoneStep guard={Route.useLoaderData()} />;
}
