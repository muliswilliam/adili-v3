import { redirect } from '@tanstack/react-router';

import { isSignedInApplicant } from '../../server/access-requests';
import { getApplicantOnboardingSession } from '../../server/applicant-onboarding';
import type { ApplicantSessionLookup } from '../../server/applicant-onboarding.server';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { type ApplicantRoute, resumeApplicantRoute, routeForApplicantSession } from './steps';

export type ApplicantStepGuard =
  { status: 'unavailable' } | { status: 'active'; session: ApplicantOnboardingSession };

/**
 * Check your email can also be opened without a session, e.g. from an expired set-password link
 * on another device or after the session's 24 hours. It then explains how to get a new link.
 */
export type ApplicantCheckEmailGuard = ApplicantStepGuard | { status: 'none' };

function toStep(
  route: ApplicantRoute,
  lookup: Exclude<ApplicantSessionLookup, { status: 'none' | 'ended' }>,
): ApplicantStepGuard {
  if (lookup.status === 'unavailable') return lookup;
  const target = routeForApplicantSession(lookup.session);
  if (target !== route) throw redirect({ to: target });
  return lookup;
}

/**
 * Loader guard for Verify your phone and Create your account: without a live session the
 * applicant starts again ("Your session ended. Start again."), and a session on another step is
 * sent to that step's route.
 */
export async function requireApplicantStep(route: ApplicantRoute): Promise<ApplicantStepGuard> {
  const lookup = await getApplicantOnboardingSession();
  if (lookup.status === 'none' || lookup.status === 'ended') {
    throw redirect({ to: '/access/get-started', search: { notice: 'ended' } });
  }
  return toStep(route, lookup);
}

/**
 * Loader guard for Check your email: like `requireApplicantStep`, except that without a session
 * (none, or ended once the set-password link has lapsed) it shows how to get a new link: the
 * account exists, so starting again would only end in "You already have an account".
 */
export async function requireApplicantCheckEmail(): Promise<ApplicantCheckEmailGuard> {
  const lookup = await getApplicantOnboardingSession();
  if (lookup.status === 'none' || lookup.status === 'ended') return { status: 'none' };
  return toStep('/access/get-started/check-email', lookup);
}

/**
 * Loader check for Choose your ID and Your details: a session in progress resumes at its step;
 * a finished or ended one does not hold the applicant, so they can start again.
 */
export function redirectIfApplicantInProgress(lookup: ApplicantSessionLookup): void {
  const resume = lookup.status === 'active' ? resumeApplicantRoute(lookup.session) : null;
  if (resume) throw redirect({ to: resume });
}

/**
 * Loader check for the access landing page: a signed-in applicant has nothing to start or sign
 * in to there, so they go to My requests, as from the portal's home.
 */
export async function redirectSignedInApplicant(): Promise<void> {
  if (await isSignedInApplicant()) throw redirect({ to: '/access/requests' });
}
