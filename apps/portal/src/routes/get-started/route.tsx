import { ToastProvider } from '@adili/ui';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { OnboardingLayout } from '../../components/onboarding/onboarding-layout';

export const Route = createFileRoute('/get-started')({
  head: () => ({ meta: [{ title: 'Get started · Adili Online' }] }),
  component: () => (
    // Above the steps, so a toast such as "Email verified" survives the move to the next one.
    <ToastProvider>
      <OnboardingLayout>
        <Outlet />
      </OnboardingLayout>
    </ToastProvider>
  ),
});
