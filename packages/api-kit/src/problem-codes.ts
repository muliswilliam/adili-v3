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
  /**
   * The service's database could not be reached (no connection in time, refused, or the session
   * turned away); transient, so callers try again later.
   */
  'database-unavailable': {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    title: 'Service unavailable',
  },
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
  /**
   * A new code, email or acknowledgement slip was asked for too soon; `retryAfterSeconds` says
   * when it may be.
   */
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
  /**
   * Submission: the token lacks the step-up ACR, or its one-time code is more than five minutes
   * old; `stepUpUrl` starts a fresh step-up and returns to the declaration.
   */
  'step-up-required': { status: HttpStatus.FORBIDDEN, title: 'Step-up required' },
  /** Submission: the declaration does not validate; `blocking` lists what to complete. */
  incomplete: { status: HttpStatus.BAD_REQUEST, title: 'Declaration incomplete' },
  /** Submission: the statement date (Africa/Nairobi) has not come yet. */
  'before-statement-date': { status: HttpStatus.CONFLICT, title: 'Before the statement date' },
  /** Submission of an amendment after the obligation's due date; changes go to the Commission. */
  'amendment-window-closed': { status: HttpStatus.CONFLICT, title: 'Amendment window closed' },
  /** Submission: the declaration is neither a draft nor an amendment in progress; reload it. */
  'not-a-draft': { status: HttpStatus.CONFLICT, title: 'Not a draft' },
  /** Amendment: only a submitted declaration can be reopened for amendment. */
  'not-submitted': { status: HttpStatus.CONFLICT, title: 'Not submitted' },
  /** Submission: the filing obligation was cancelled, so there is nothing to file. */
  'obligation-cancelled': { status: HttpStatus.CONFLICT, title: 'Obligation cancelled' },
  /** Acknowledgement: the version's slip is issued already; there is nothing to ask for again. */
  'acknowledgement-issued': { status: HttpStatus.CONFLICT, title: 'Acknowledgement issued' },
  /** Acknowledgement: the slip is still being prepared; ask again only once it has failed. */
  'acknowledgement-in-progress': {
    status: HttpStatus.CONFLICT,
    title: 'Acknowledgement in progress',
  },
  /** Registry lookups: the declarant did not say they request the check; nothing ran. */
  'consent-required': { status: HttpStatus.BAD_REQUEST, title: 'Consent required' },
  /** Registry lookups: the person has no national ID in Household to be looked up by. */
  'no-id': { status: HttpStatus.BAD_REQUEST, title: 'No national ID' },
} as const satisfies Record<string, { status: HttpStatus; title: string }>;

export type ProblemCode = keyof typeof PROBLEM_CODES;

/** The registry's codes, for contracts: the `code` member of `ProblemDetails`. */
export const problemCodeSchema = z
  .enum(Object.keys(PROBLEM_CODES) as [ProblemCode, ...ProblemCode[]])
  .meta({
    description:
      'Machine-readable cause, from the platform registry; clients map it to copy and never show `title` or `detail`',
  });
