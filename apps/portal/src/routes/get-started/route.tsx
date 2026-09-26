import { createFileRoute, Outlet } from '@tanstack/react-router';

import { OnboardingLayout } from '../../components/onboarding/onboarding-layout';

export const Route = createFileRoute('/get-started')({
  head: () => ({ meta: [{ title: 'Get started · Adili Online' }] }),
  component: () => (
    <OnboardingLayout>
      <Outlet />
    </OnboardingLayout>
  ),
});
