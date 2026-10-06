import type { OnboardingSession, OnboardingState } from '../../server/directory/types';

/** Every route in the Get started flow, in order. */
export const STEP_ROUTES = [
  '/get-started',
  '/get-started/identify',
  '/get-started/verify-email',
  '/get-started/verify-phone',
  '/get-started/confirm',
  '/get-started/check-email',
  '/get-started/done',
  '/get-started/not-verified',
] as const;

export type StepRoute = (typeof STEP_ROUTES)[number];

/** The six steps the stepper shows. Check your email and Done are both the last one. */
export const STEP_NAMES = [
  'Choose your Commission',
  'Identify yourself',
  'Verify your email',
  'Verify your phone',
  'Confirm your details',
  'Check your email',
] as const;

export const STEP_COUNT = STEP_NAMES.length;

export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6;

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The step a Get started route shows in the stepper; unset for pages outside it. */
    onboardingStep?: StepNumber;
    /** Shows a Back button to the Commission step above the stepper. */
    onboardingBack?: boolean;
  }
}

const ROUTE_FOR_STATE: Record<Exclude<OnboardingState, 'confirmed'>, StepRoute> = {
  // A session is only `identified` for the moment before the first code goes out.
  identified: '/get-started/verify-email',
  'email-contact-required': '/get-started/verify-email',
  'email-pending': '/get-started/verify-email',
  'email-verified': '/get-started/verify-phone',
  'phone-contact-required': '/get-started/verify-phone',
  'phone-pending': '/get-started/verify-phone',
  'phone-verified': '/get-started/confirm',
  'identity-mismatch': '/get-started/not-verified',
  expired: '/get-started',
};

/**
 * The one route a session belongs on. `confirmed` splits on the outcome: a new account waits
 * for its set-password email; a linked account is done.
 */
export function routeForSession(session: Pick<OnboardingSession, 'state' | 'outcome'>): StepRoute {
  if (session.state === 'confirmed') {
    return session.outcome === 'linked-existing-account'
      ? '/get-started/done'
      : '/get-started/check-email';
  }
  return ROUTE_FOR_STATE[session.state];
}

/**
 * Where a declarant who comes back to the start of Get started (Choose your Commission or
 * Identify) is sent: the step their session is on, or null when it has finished (an account
 * created or linked, or stopped at identity mismatch) or ended, so they can start a new
 * onboarding, e.g. for another Commission, and are not trapped on a finished page. Nothing
 * clears a finished session's cookie on its own: Check your email, Done and Not verified still
 * show on a refresh or Back while the cookie lasts, until the declarant starts again or
 * identifies for a new onboarding, which replaces it.
 */
export function resumeRoute(
  session: Pick<OnboardingSession, 'state' | 'outcome'>,
): Exclude<StepRoute, '/get-started'> | null {
  if (session.state === 'confirmed' || session.state === 'identity-mismatch') return null;
  const route = routeForSession(session);
  return route === '/get-started' ? null : route;
}
