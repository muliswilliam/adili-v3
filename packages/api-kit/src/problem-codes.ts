import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

/**
 * Every problem `code` a service may send, with the status and title it is sent with. Front ends
 * map codes to copy (in the user's language); they never show `title` or `detail`, which are
 * for developers and logs. A code means the same thing on every route that sends it.
 *
 * Add a code here before a service throws it, and give it the copy in the front ends' table.
 */
export const PROBLEM_CODES = {
  /** Too many requests for the caller's budget; `retryAfterSeconds` says when to try again. */
  'rate-limit-exceeded': { status: HttpStatus.TOO_MANY_REQUESTS, title: 'Too Many Requests' },
  /** Onboarding: nothing on the Commission's roster matches, whatever the cause. */
  'no-match': { status: HttpStatus.NOT_FOUND, title: 'No matching roster record' },
  /** Onboarding: the roster record is onboarded already; `links` point to sign-in and recovery. */
  'already-onboarded': { status: HttpStatus.CONFLICT, title: 'Already onboarded' },
  /** Onboarding: the Commission has not imported its roster yet. */
  'no-roster': { status: HttpStatus.CONFLICT, title: 'Commission roster not imported' },
  /** Onboarding: wrong one-time code; `attemptsLeft` says how many tries remain. */
  'otp-invalid': { status: HttpStatus.BAD_REQUEST, title: 'Invalid code' },
  /** Onboarding: the one-time code is past its expiry; a new one must be sent. */
  'otp-expired': { status: HttpStatus.BAD_REQUEST, title: 'Code expired' },
  /** A new code or email was asked for too soon; `retryAfterSeconds` says when it may be. */
  'resend-cooldown': { status: HttpStatus.TOO_MANY_REQUESTS, title: 'Resend cooldown' },
  /** Onboarding: the one-time code could not be sent; nothing changed, try again. */
  'otp-send-failed': { status: HttpStatus.BAD_GATEWAY, title: 'Code not sent' },
  /**
   * Onboarding: the session is not at the step asked for (another tab moved it on, or the step
   * is done); the client re-reads the session.
   */
  'wrong-step': { status: HttpStatus.CONFLICT, title: 'Session is not at this step' },
  /** Onboarding: the session ended (expired, too many attempts); start again. */
  'session-expired': { status: HttpStatus.GONE, title: 'Session expired' },
  /** Onboarding: the IPRS check could not run; nothing changed, try again later. */
  'iprs-unavailable': { status: HttpStatus.SERVICE_UNAVAILABLE, title: 'IPRS unavailable' },
  /** Onboarding: the account could not be created or linked; nothing changed. */
  'identity-unavailable': {
    status: HttpStatus.BAD_GATEWAY,
    title: 'Identity provider unavailable',
  },
  /**
   * Onboarding: the verified email already belongs to another account (e.g. a staff account), so
   * no declarant account can be created with it; nothing changed.
   */
  'email-in-use': { status: HttpStatus.CONFLICT, title: 'Email belongs to another account' },
} as const satisfies Record<string, { status: HttpStatus; title: string }>;

export type ProblemCode = keyof typeof PROBLEM_CODES;

/** The registry's codes, for contracts: the `code` member of `ProblemDetails`. */
export const problemCodeSchema = z
  .enum(Object.keys(PROBLEM_CODES) as [ProblemCode, ...ProblemCode[]])
  .meta({
    description:
      'Machine-readable cause, from the platform registry; clients map it to copy and never show `title` or `detail`',
  });
