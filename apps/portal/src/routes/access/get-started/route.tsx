import { createFileRoute, Outlet } from '@tanstack/react-router';

import { ApplicantFrame } from '../../../components/applicant-onboarding/applicant-frame';
import { APPLICANT_TITLES_COPY } from '../../../components/applicant-onboarding/copy';
import { AuthShell } from '../../../components/auth-shell';

export const Route = createFileRoute('/access/get-started')({
  head: () => ({ meta: [{ title: APPLICANT_TITLES_COPY.getStarted }] }),
  component: () => (
    <AuthShell art="access">
      <ApplicantFrame>
        <Outlet />
      </ApplicantFrame>
    </AuthShell>
  ),
});
