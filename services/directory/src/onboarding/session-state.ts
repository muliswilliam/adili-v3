/**
 * The onboarding session's state machine and timing rules (spec 03). Pure: the repository
 * (`sessions.repository.ts`) applies them, and every step module goes through it.
 *
 *     identified ─┬─> email-pending ──────────────┬─> email-verified ─┬─> phone-pending ─────────────┬─> phone-verified ─┬─> confirmed
 *                 └─> email-contact-required ─> ──┘                   └─> phone-contact-required ─> ─┘                  └─> identity-mismatch
 *
 * Any live state may also end as `expired` (session past `expiresAt`, or codes or resends
 * exhausted). `confirmed`, `identity-mismatch` and `expired` are terminal.
 */

export const ONBOARDING_STATES = [
  'identified',
  'email-contact-required',
  'email-pending',
  'email-verified',
  'phone-contact-required',
  'phone-pending',
  'phone-verified',
  'confirmed',
  'identity-mismatch',
  'expired',
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const TERMINAL_STATES = [
  'confirmed',
  'identity-mismatch',
  'expired',
] as const satisfies readonly OnboardingState[];
export type TerminalState = (typeof TERMINAL_STATES)[number];

export const OTP_CHANNELS = ['email', 'phone'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

/** How confirm ended, as the declarant is told (`OnboardingOutcome` in the contract). */
export const ONBOARDING_OUTCOMES = [
  'account-created',
  'linked-existing-account',
  'identity-mismatch',
] as const;
export type OnboardingOutcome = (typeof ONBOARDING_OUTCOMES)[number];

/** Why a session ended, as `onboarding.session.ended.v1` reports it. */
export const END_REASONS = ['confirmed', 'identity-mismatch', 'expired', 'rate-limited'] as const;
export type EndReason = (typeof END_REASONS)[number];

/** What IPRS said about the national ID and names at confirm. */
export const IPRS_OUTCOMES = ['match', 'mismatch', 'not-found'] as const;
export type IprsOutcome = (typeof IPRS_OUTCOMES)[number];

/** The states each state may move to; `expired` is reachable from every live state. */
const TRANSITIONS: Record<OnboardingState, readonly OnboardingState[]> = {
  identified: ['email-pending', 'email-contact-required'],
  'email-contact-required': ['email-pending'],
  'email-pending': ['email-verified'],
  'email-verified': ['phone-pending', 'phone-contact-required'],
  'phone-contact-required': ['phone-pending'],
  'phone-pending': ['phone-verified'],
  'phone-verified': ['confirmed', 'identity-mismatch'],
  confirmed: [],
  'identity-mismatch': [],
  expired: [],
};

export function isTerminal(state: OnboardingState): state is TerminalState {
  return (TERMINAL_STATES as readonly OnboardingState[]).includes(state);
}

export function canTransition(from: OnboardingState, to: OnboardingState): boolean {
  if (to === 'expired') return !isTerminal(from);
  return TRANSITIONS[from].includes(to);
}

/** The channel whose code the session waits for, if any. */
export function pendingChannel(state: OnboardingState): OtpChannel | null {
  if (state === 'email-pending') return 'email';
  if (state === 'phone-pending') return 'phone';
  return null;
}

/** The channel whose contact the session waits for the declarant to supply, if any. */
export function contactRequiredChannel(state: OnboardingState): OtpChannel | null {
  if (state === 'email-contact-required') return 'email';
  if (state === 'phone-contact-required') return 'phone';
  return null;
}

/** Whether the session shows the roster details (the confirm step and after). */
export function showsDetails(state: OnboardingState): boolean {
  return state === 'phone-verified' || state === 'confirmed' || state === 'identity-mismatch';
}

const MINUTE_MS = 60 * 1000;

/** Timing rules of sessions and their one-time codes (spec 03, OTP and rate limits). */
export const ONBOARDING_TIMING = {
  /** A new session lives this long... */
  sessionTtlMs: 30 * MINUTE_MS,
  /** ...extended by this on each successful step... */
  stepExtensionMs: 10 * MINUTE_MS,
  /** ...up to this long after it was created. */
  sessionCapMs: 60 * MINUTE_MS,
  /** A one-time code is valid this long after it was sent. */
  otpTtlMs: 10 * MINUTE_MS,
  /** Wrong codes allowed against one code; the last one ends the session. */
  otpAttempts: 5,
  /** A new code (or set-password email) may be asked for this long after the last one. */
  resendCooldownMs: MINUTE_MS,
  /** Codes that may be sent per channel after the first; one more ends the session. */
  otpResends: 3,
} as const;

/** When something last sent at `lastSentAt` (a code, the set-password email) may be sent again. */
export function resendAvailableAt(lastSentAt: Date): Date {
  return new Date(lastSentAt.getTime() + ONBOARDING_TIMING.resendCooldownMs);
}

/** When a session created at `now` expires. */
export function initialExpiry(now: Date): Date {
  return new Date(now.getTime() + ONBOARDING_TIMING.sessionTtlMs);
}

/** A session's expiry after a successful step: 10 minutes later, capped at 60 after creation. */
export function extendedExpiry(session: { createdAt: Date; expiresAt: Date }): Date {
  return new Date(
    Math.min(
      session.expiresAt.getTime() + ONBOARDING_TIMING.stepExtensionMs,
      session.createdAt.getTime() + ONBOARDING_TIMING.sessionCapMs,
    ),
  );
}

/** Whether a session has run out at `now`, whatever its state. */
export function hasExpired(session: { state: OnboardingState; expiresAt: Date }, now: Date) {
  return session.state === 'expired' || session.expiresAt.getTime() <= now.getTime();
}
