import type { OnboardingSession, OnboardingState } from '../../server/directory/types';

/** Every route in the Get started flow, in order. */
export const STEP_ROUTES = [
  '/get-started',
  '/get-started/verify-email',
  '/get-started/verify-phone',
  '/get-started/confirm',
  '/get-started/check-email',
  '/get-started/done',
  '/get-started/not-verified',
] as const;

export type StepRoute = (typeof STEP_ROUTES)[number];

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
