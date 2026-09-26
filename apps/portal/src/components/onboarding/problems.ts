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
      : `That code is not right. You have ${plural(attemptsLeft, 'attempt', 'attempts')} left.`,
  'otp-expired': () => 'That code has expired. Ask for a new one.',
  'resend-cooldown': ({ retryAfterSeconds }) =>
    retryAfterSeconds === undefined
      ? 'Wait a moment before asking for another code.'
      : `Wait ${plural(retryAfterSeconds, 'second', 'seconds')} before asking for another code.`,
  'session-expired': () => 'Your session ended. Start again.',
  'iprs-unavailable': () =>
    'We cannot reach the national register right now. Your details are saved. Try again in a few minutes.',
  'identity-unavailable': () =>
    'We could not create your account. Nothing was changed. Try again in a few minutes.',
  'rate-limited': ({ retryAfterSeconds }) =>
    `Too many attempts. Try again in ${plural(minutesFrom(retryAfterSeconds ?? 60), 'minute', 'minutes')}.`,
};

export const GENERIC_ERROR = 'Something went wrong. Try again.';

export function problemMessage(code: OnboardingProblemCode, context: ProblemContext = {}): string {
  return PROBLEM_COPY[code](context);
}
