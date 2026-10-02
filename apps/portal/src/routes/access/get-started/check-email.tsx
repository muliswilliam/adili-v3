import { createFileRoute } from '@tanstack/react-router';

import { ApplicantCheckEmailStep } from '../../../components/applicant-onboarding/check-email-step';
import { APPLICANT_TITLES_COPY } from '../../../components/applicant-onboarding/copy';
import { requireApplicantCheckEmail } from '../../../components/applicant-onboarding/guard';

export const Route = createFileRoute('/access/get-started/check-email')({
  staticData: { applicantStep: 5 },
  head: () => ({ meta: [{ title: APPLICANT_TITLES_COPY.checkEmail }] }),
  loader: () => requireApplicantCheckEmail(),
  component: CheckEmail,
});

function CheckEmail() {
  return <ApplicantCheckEmailStep guard={Route.useLoaderData()} />;
}
