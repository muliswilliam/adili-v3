import type {
  ApplicantOnboardingSession,
  ApplicantOnboardingState,
} from '../../server/directory/types';
import { APPLICANT_STEPS_COPY as STEPS } from './copy';

/** Every route in Get started as an applicant, in order. */
export const APPLICANT_ROUTES = [
  '/access/get-started',
  '/access/get-started/details',
  '/access/get-started/verify-phone',
  '/access/get-started/create',
  '/access/get-started/check-email',
] as const;

export type ApplicantRoute = (typeof APPLICANT_ROUTES)[number];

/** The five steps the stepper shows, one per route. */
export const APPLICANT_STEP_NAMES = [
  STEPS.chooseId,
  STEPS.details,
  STEPS.verifyPhone,
  STEPS.create,
  STEPS.setPassword,
] as const;

export type ApplicantStepNumber = 1 | 2 | 3 | 4 | 5;

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The step a Get started as an applicant route shows in the stepper. */
    applicantStep?: ApplicantStepNumber;
    /** Where the Back button above the stepper goes; no button when unset. */
    applicantBack?: '/access' | '/access/get-started';
  }
}

const ROUTE_FOR_STATE: Record<ApplicantOnboardingState, ApplicantRoute> = {
  // A session is only `identified` for the moment before its code goes out.
  identified: '/access/get-started/verify-phone',
  'phone-pending': '/access/get-started/verify-phone',
  'phone-verified': '/access/get-started/create',
  confirmed: '/access/get-started/check-email',
  expired: '/access/get-started',
};

/** The one route a session belongs on. */
export function routeForApplicantSession(
  session: Pick<ApplicantOnboardingSession, 'state'>,
): ApplicantRoute {
  return ROUTE_FOR_STATE[session.state];
}

/**
 * Where an applicant who comes back to the start (Choose your ID or Your details) is sent: the
 * step their session is on, or null when it has finished (the account created) or ended, so they
 * can start again rather than be held on Check your email.
 */
export function resumeApplicantRoute(
  session: Pick<ApplicantOnboardingSession, 'state'>,
): Exclude<ApplicantRoute, '/access/get-started' | '/access/get-started/details'> | null {
  const route = routeForApplicantSession(session);
  if (
    session.state === 'confirmed' ||
    route === '/access/get-started' ||
    route === '/access/get-started/details'
  ) {
    return null;
  }
  return route;
}
