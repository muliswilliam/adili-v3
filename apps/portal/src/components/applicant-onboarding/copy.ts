import type { ApplicantOnboardingProblemCode } from '../../server/directory/types';
import { problemMessage } from '../onboarding/problems';

/**
 * What the applicant reads for each problem code of the applicant onboarding contract
 * (`ApplicantOnboardingProblem`). The directory never sends user-facing text; codes shared with
 * the declarant's onboarding read the same as there.
 */
export const APPLICANT_PROBLEM_COPY: Record<
  ApplicantOnboardingProblemCode,
  (context: { attemptsLeft?: number; retryAfterSeconds?: number }) => string
> = {
  'identity-mismatch': () =>
    'These details do not match the national register. Enter your names and ID number exactly as they appear on your ID.',
  'already-onboarded': () => 'You already have an account.',
  'email-in-use': () =>
    'This email address already belongs to another Adili account, so your account could not be created. Start again with another email address, or sign in to that account.',
  'otp-invalid': (context) => problemMessage('otp-invalid', context),
  'otp-expired': () => problemMessage('otp-expired'),
  'otp-send-failed': () => problemMessage('otp-send-failed'),
  'resend-cooldown': (context) => problemMessage('resend-cooldown', context),
  'session-expired': () => problemMessage('session-expired'),
  'iprs-unavailable': () => problemMessage('iprs-unavailable'),
  'identity-unavailable': () => problemMessage('identity-unavailable'),
  'rate-limit-exceeded': (context) => problemMessage('rate-limit-exceeded', context),
  'wrong-step': () => problemMessage('wrong-step'),
};

export function applicantProblemMessage(
  code: ApplicantOnboardingProblemCode,
  context: { attemptsLeft?: number; retryAfterSeconds?: number } = {},
): string {
  return APPLICANT_PROBLEM_COPY[code](context);
}

/** A passport holder's identity is checked by people, not the national register. */
export const PASSPORT_NOTICE =
  'Your identity will be verified by the Commission when you submit your first request.';
