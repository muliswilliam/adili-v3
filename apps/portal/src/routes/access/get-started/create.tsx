import { createFileRoute } from '@tanstack/react-router';

import { APPLICANT_TITLES_COPY } from '../../../components/applicant-onboarding/copy';
import { CreateStep } from '../../../components/applicant-onboarding/create-step';
import { requireApplicantStep } from '../../../components/applicant-onboarding/guard';

export const Route = createFileRoute('/access/get-started/create')({
  staticData: { applicantStep: 4 },
  head: () => ({ meta: [{ title: APPLICANT_TITLES_COPY.create }] }),
  loader: () => requireApplicantStep('/access/get-started/create'),
  component: Create,
});

function Create() {
  return <CreateStep guard={Route.useLoaderData()} />;
}
