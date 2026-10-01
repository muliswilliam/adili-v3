import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { redirectIfApplicantInProgress } from '../../../components/applicant-onboarding/guard';
import { IdTypeStep } from '../../../components/applicant-onboarding/id-type-step';
import { getApplicantOnboardingSession } from '../../../server/applicant-onboarding';

export const Route = createFileRoute('/access/get-started/')({
  validateSearch: z.object({
    /** Preselects the ID type, e.g. on Back from Your details or after starting again. */
    kind: z.enum(['national-id', 'passport']).optional(),
    /** Why the applicant is starting again. */
    notice: z.enum(['ended', 'too-many']).optional(),
  }),
  staticData: { applicantStep: 1, applicantBack: '/access' },
  head: () => ({ meta: [{ title: 'Choose your ID · Adili Online' }] }),
  loader: async () => {
    redirectIfApplicantInProgress(await getApplicantOnboardingSession());
  },
  component: ChooseId,
});

function ChooseId() {
  const { kind, notice } = Route.useSearch();
  return <IdTypeStep preselected={kind} notice={notice} />;
}
