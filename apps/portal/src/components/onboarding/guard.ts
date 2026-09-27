import { redirect } from '@tanstack/react-router';

import type { OnboardingSession } from '../../server/directory/types';
import { getOnboardingSession } from '../../server/onboarding';
import type { SessionLookup } from '../../server/onboarding.server';
import { routeForSession, type StepRoute } from './steps';

export type StepGuard =
  { status: 'unavailable' } | { status: 'active'; session: OnboardingSession };

/**
 * Check your email can also be opened with no session cookie at all, e.g. from an expired
 * set-password link on another device. It then explains how to get a new link.
 */
export type CheckEmailGuard = StepGuard | { status: 'none' };

/** The redirect to Choose your Commission with "Your session ended. Start again." */
function redirectToStart() {
  return redirect({ to: '/get-started', search: { notice: 'ended' } });
}

/**
 * A live session on this route passes; one on another step is sent to that step's route. The
 * lookup already reports an expired session as ended, so an active one always has a step.
 */
function toStep(
  route: StepRoute,
  lookup: Exclude<SessionLookup, { status: 'none' | 'ended' }>,
): StepGuard {
  if (lookup.status === 'unavailable') return lookup;
  const target = routeForSession(lookup.session);
  if (target !== route) throw redirect({ to: target });
  return lookup;
}

/**
 * Loader guard for every step after the first: without a live session the declarant starts
 * again, and a session on another step is sent to that step's route.
 */
export async function requireStep(route: StepRoute): Promise<StepGuard> {
  const lookup = await getOnboardingSession();
  if (lookup.status === 'none' || lookup.status === 'ended') throw redirectToStart();
  return toStep(route, lookup);
}

/**
 * Loader guard for Check your email: like `requireStep`, except that with no session cookie it
 * shows how to get a new link (see `CheckEmailGuard`).
 */
export async function requireCheckEmail(): Promise<CheckEmailGuard> {
  const lookup = await getOnboardingSession();
  if (lookup.status === 'none') return { status: 'none' };
  if (lookup.status === 'ended') throw redirectToStart();
  return toStep('/get-started/check-email', lookup);
}
