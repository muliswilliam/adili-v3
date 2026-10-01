import { createFileRoute } from '@tanstack/react-router';

import { requireApplicantStep } from '../../../components/applicant-onboarding/guard';
import { VerifyPhoneStep } from '../../../components/applicant-onboarding/verify-phone-step';

export const Route = createFileRoute('/access/get-started/verify-phone')({
  staticData: { applicantStep: 3 },
  head: () => ({ meta: [{ title: 'Verify your phone · Adili Online' }] }),
  loader: () => requireApplicantStep('/access/get-started/verify-phone'),
  component: VerifyPhone,
});

function VerifyPhone() {
  return <VerifyPhoneStep guard={Route.useLoaderData()} />;
}
