import { createFileRoute } from '@tanstack/react-router';

import { APPLICANT_TITLES_COPY } from '../../../components/applicant-onboarding/copy';
import { requireApplicantStep } from '../../../components/applicant-onboarding/guard';
import { VerifyPhoneStep } from '../../../components/applicant-onboarding/verify-phone-step';

export const Route = createFileRoute('/access/get-started/verify-phone')({
  staticData: { applicantStep: 3 },
  head: () => ({ meta: [{ title: APPLICANT_TITLES_COPY.verifyPhone }] }),
  loader: () => requireApplicantStep('/access/get-started/verify-phone'),
  component: VerifyPhone,
});

function VerifyPhone() {
  return <VerifyPhoneStep guard={Route.useLoaderData()} />;
}
