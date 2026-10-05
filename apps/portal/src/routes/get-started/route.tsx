import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AuthShell } from '../../components/auth-shell';
import { OnboardingFrame } from '../../components/onboarding/onboarding-layout';

export const Route = createFileRoute('/get-started')({
  head: () => ({ meta: [{ title: 'Get started · Adili Online' }] }),
  component: () => (
    <AuthShell>
      <OnboardingFrame>
        <Outlet />
      </OnboardingFrame>
    </AuthShell>
  ),
});
