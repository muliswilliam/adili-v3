import { createFileRoute, Outlet } from '@tanstack/react-router';

import { ApplicantFrame } from '../../../components/applicant-onboarding/applicant-frame';
import { AuthShell } from '../../../components/auth-shell';

export const Route = createFileRoute('/access/get-started')({
  head: () => ({ meta: [{ title: 'Get started · Adili Online' }] }),
  component: () => (
    <AuthShell art="access">
      <ApplicantFrame>
        <Outlet />
      </ApplicantFrame>
    </AuthShell>
  ),
});
