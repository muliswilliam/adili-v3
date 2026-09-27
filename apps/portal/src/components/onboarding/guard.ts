import { redirect } from '@tanstack/react-router';

import type { OnboardingSession } from '../../server/directory/types';
import { getOnboardingSession, leaveOnboarding } from '../../server/onboarding';
import type { SessionLookup } from '../../server/onboarding.server';
import { routeForSession, type StepRoute } from './steps';

export type StepGuard =
  { status: 'unavailable' } | { status: 'active'; session: OnboardingSession };

/**
 * Check your email can also be opened without a session: from an expired set-password link on
 * another device, or after the session lapsed. It then explains how to get a new link.
 */
export type CheckEmailGuard = StepGuard | { status: 'none' };

function startAgain(commission?: string) {
  return redirect({ to: '/get-started', search: { commission, notice: 'ended' } });
}

/** A live session on this route passes; one on another step is sent to that step's route. */
async function toStep(
  route: StepRoute,
  lookup: Exclude<SessionLookup, { status: 'none' | 'ended' }>,
): Promise<StepGuard> {
  if (lookup.status === 'unavailable') return lookup;
  const target = routeForSession(lookup.session);
  if (target === '/get-started') {
    // Expired: nothing can move it on, so forget it in this browser.
    await leaveOnboarding();
    throw startAgain(lookup.session.commission.slug);
  }
  if (target !== route) {
    throw redirect({ to: target });
  }
  return lookup;
}

/**
 * Loader guard for every step after the first: without a live session the declarant starts
 * again, and a session on another step is sent to that step's route.
 */
export async function requireStep(route: StepRoute): Promise<StepGuard> {
  const lookup = await getOnboardingSession();
  if (lookup.status === 'none' || lookup.status === 'ended') throw startAgain();
  return toStep(route, lookup);
}

/** Loader guard for Check your email; see `CheckEmailGuard`. */
export async function requireCheckEmail(): Promise<CheckEmailGuard> {
  const lookup = await getOnboardingSession();
  if (lookup.status === 'none' || lookup.status === 'ended') return { status: 'none' };
  return toStep('/get-started/check-email', lookup);
}
