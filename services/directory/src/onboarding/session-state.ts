/**
 * The onboarding session's state machine and timing rules (spec 03). Pure: the repository
 * (`sessions.repository.ts`) applies them, and every step module goes through it.
 *
 *     identified ─┬─> email-pending ──────────────┬─> email-verified ─┬─> phone-pending ─────────────┬─> phone-verified ─┬─> confirmed
 *                 └─> email-contact-required ─> ──┘                   └─> phone-contact-required ─> ─┘                  └─> identity-mismatch
 *
 * Any live state may also end as `expired` (session past `expiresAt`, or codes or resends
 * exhausted). `confirmed`, `identity-mismatch` and `expired` are terminal. A terminal session
 * stays readable until its `expiresAt`; a `confirmed` one with a new account lives as long as
 * its set-password link (`confirmedExpiry`), for resend-password-email.
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

/** How confirm ended, as the declarant is told (`OnboardingOutcome` in the contract). */
export const ONBOARDING_OUTCOMES = [
  'account-created',
  'linked-existing-account',
  'identity-mismatch',
] as const;
export type OnboardingOutcome = (typeof ONBOARDING_OUTCOMES)[number];

/**
 * Whether a new account's set-password email went. It is sent after confirm commits, so it can
 * fail while the account stands; the declarant then sends it with resend (spec 03, ADR-014).
 */
export const SET_PASSWORD_EMAIL_STATUSES = ['sent', 'failed'] as const;
export type SetPasswordEmailStatus = (typeof SET_PASSWORD_EMAIL_STATUSES)[number];

/**
 * The set-password email of a session confirmed with a new account: `sent` while the session
 * records when it last went, `failed` when it records none. Null for every other session.
 */
export function setPasswordEmailStatus(session: {
  outcome: OnboardingOutcome | null;
  passwordEmailSentAt: Date | null;
}): SetPasswordEmailStatus | null {
  if (session.outcome !== 'account-created') return null;
  return session.passwordEmailSentAt === null ? 'failed' : 'sent';
}

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

/** Whether the session shows the roster details (the confirm step and after). */
export function showsDetails(state: OnboardingState): boolean {
  return state === 'phone-verified' || state === 'confirmed' || state === 'identity-mismatch';
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Timing rules of sessions and their one-time codes (spec 03, OTP and rate limits). */
export const ONBOARDING_TIMING = {
  /** A new session lives this long... */
  sessionTtlMs: 30 * MINUTE_MS,
  /** ...extended by this on each successful step... */
  stepExtensionMs: 10 * MINUTE_MS,
  /** ...up to this long after it was created (the steps before confirm). */
  sessionCapMs: 60 * MINUTE_MS,
  /**
   * How long a set-password link stays valid, and so how long a session confirmed with a new
   * account lives after confirm: the check-email step can resend the link while it could lapse.
   */
  setPasswordLinkTtlMs: 24 * HOUR_MS,
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

/**
 * The expiry of a session confirmed at `now` with a new account: the set-password link's
 * lifespan, so the check-email step can send a fresh link however late the first one lapses.
 * The 60-minute cap bounds only the steps before confirm; a confirmed session serves nothing
 * but reading it and resend-password-email.
 */
export function confirmedExpiry(now: Date): Date {
  return new Date(now.getTime() + ONBOARDING_TIMING.setPasswordLinkTtlMs);
}

/** Whether a session has run out at `now`, whatever its state. */
export function hasExpired(session: { state: OnboardingState; expiresAt: Date }, now: Date) {
  return session.state === 'expired' || session.expiresAt.getTime() <= now.getTime();
}
