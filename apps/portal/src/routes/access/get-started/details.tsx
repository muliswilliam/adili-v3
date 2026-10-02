import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { APPLICANT_TITLES_COPY } from '../../../components/applicant-onboarding/copy';
import { DetailsStep } from '../../../components/applicant-onboarding/details-step';
import { redirectIfApplicantInProgress } from '../../../components/applicant-onboarding/guard';
import { getApplicantOnboardingSession } from '../../../server/applicant-onboarding';

export const Route = createFileRoute('/access/get-started/details')({
  validateSearch: z.object({
    /** The ID type chosen on step 1; without it the applicant chooses first. */
    kind: z.enum(['national-id', 'passport']).optional(),
  }),
  staticData: { applicantStep: 2, applicantBack: '/access/get-started' },
  head: () => ({ meta: [{ title: APPLICANT_TITLES_COPY.details }] }),
  loaderDeps: ({ search }) => ({ kind: search.kind }),
  loader: async ({ deps }) => {
    redirectIfApplicantInProgress(await getApplicantOnboardingSession());
    if (!deps.kind) throw redirect({ to: '/access/get-started' });
    return { kind: deps.kind };
  },
  component: Details,
});

function Details() {
  const { kind } = Route.useLoaderData();
  // A new form for the other ID type, so nothing typed for one carries over to the other.
  return <DetailsStep key={kind} kind={kind} />;
}
