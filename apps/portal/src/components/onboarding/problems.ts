import type { OnboardingProblemCode } from '../../server/directory/types';

export interface ProblemContext {
  commissionName?: string;
  attemptsLeft?: number;
  retryAfterSeconds?: number;
}

/** Whole minutes for a wait, never less than one. */
export function minutesFrom(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

function plural(count: number, one: string, many: string) {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * What the declarant reads for each problem code in the contract. The directory never sends
 * user-facing text; this table is the only place it lives (S24).
 */
export const PROBLEM_COPY: Record<OnboardingProblemCode, (context: ProblemContext) => string> = {
  'no-match': ({ commissionName }) =>
    `We could not match these details to ${commissionName ?? 'your Commission'}'s roster. Check both numbers and try again. If they are correct, contact your Commission's reporting officer to have your record added or corrected.`,
  'already-onboarded': () => 'You already have an Adili account.',
  'no-roster': ({ commissionName }) =>
    `${commissionName ?? 'This Commission'} has not yet imported its roster. You cannot onboard until it does. Ask your Commission's reporting officer when it will be ready.`,
  'otp-invalid': ({ attemptsLeft }) =>
    attemptsLeft === undefined
      ? 'That code is not right. Check it and try again.'
      : `That code is not right. ${plural(attemptsLeft, 'attempt', 'attempts')} left.`,
  'otp-expired': () => 'That code has expired. Resend to get a new one.',
  // Not shown as a message: the resend link counts down instead.
  'resend-cooldown': ({ retryAfterSeconds }) =>
    retryAfterSeconds === undefined
      ? 'Wait a moment before asking for another code.'
      : `Wait ${plural(retryAfterSeconds, 'second', 'seconds')} before asking for another code.`,
  'session-expired': () => 'Your session ended. Start again.',
  'iprs-unavailable': () =>
    'The national register is not responding. Wait a few minutes and try again.',
  'identity-unavailable': () => 'Your account could not be created. Try again.',
  'email-in-use': () =>
    'This email address already belongs to another Adili account, so your account could not be created. Contact the EACC helpdesk.',
  'rate-limit-exceeded': ({ retryAfterSeconds }) =>
    `Too many attempts. Try again in ${plural(minutesFrom(retryAfterSeconds ?? 60), 'minute', 'minutes')}.`,
};

export const GENERIC_ERROR = 'Something went wrong. Try again.';

/**
 * Why the declarant is back on the Commission step. The contract's 410 cannot say whether the
 * session lapsed or ran out of attempts; the portal knows the second only when it saw the last
 * wrong code or had no resends left.
 */
export const START_AGAIN_NOTICES = {
  ended: 'Your session ended. Start again.',
  'too-many': 'Too many attempts. Start again.',
} as const;

export type StartAgainNotice = keyof typeof START_AGAIN_NOTICES;

/** A code could not be sent (the directory's 502, which has no problem code in the contract). */
export const SEND_FAILED = 'We could not send the code. Try again in a minute.';

export function problemMessage(code: OnboardingProblemCode, context: ProblemContext = {}): string {
  return PROBLEM_COPY[code](context);
}
