import { redirect } from '@tanstack/react-router';

import type { OnboardingSession } from '../../server/directory/types';
import { getOnboardingSession } from '../../server/onboarding';
import { routeForSession, type StepRoute } from './steps';

export type StepGuard =
  { status: 'unavailable' } | { status: 'active'; session: OnboardingSession };

/**
 * Loader guard for every step after the first: without a live session the declarant starts
 * again, and a session on another step is sent to that step's route.
 */
export async function requireStep(route: StepRoute): Promise<StepGuard> {
  const lookup = await getOnboardingSession();
  if (lookup.status === 'unavailable') return lookup;
  if (lookup.status !== 'active') {
    throw redirect({ to: '/get-started', search: { notice: 'ended' } });
  }
  const target = routeForSession(lookup.session);
  if (target === '/get-started') {
    throw redirect({ to: '/get-started', search: { notice: 'ended' } });
  }
  if (target !== route) {
    throw redirect({ to: target });
  }
  return lookup;
}
