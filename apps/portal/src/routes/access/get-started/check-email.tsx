import { createFileRoute } from '@tanstack/react-router';

import { ApplicantCheckEmailStep } from '../../../components/applicant-onboarding/check-email-step';
import { requireApplicantCheckEmail } from '../../../components/applicant-onboarding/guard';

export const Route = createFileRoute('/access/get-started/check-email')({
  staticData: { applicantStep: 5 },
  head: () => ({ meta: [{ title: 'Check your email · Adili Online' }] }),
  loader: () => requireApplicantCheckEmail(),
  component: CheckEmail,
});

function CheckEmail() {
  return <ApplicantCheckEmailStep guard={Route.useLoaderData()} />;
}
