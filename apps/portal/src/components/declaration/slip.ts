import { plural } from '@adili/ui';

import type { Acknowledgement } from '../../server/declarations/types';
import type { Unauthenticated } from '../../server/results';
import type { ReissueOutcome } from '../../server/submission.server';

/**
 * The acknowledgement slip on the success page (spec 06 FE-3, S19) as a pure state machine. The
 * slip is issued asynchronously after the submit, so the card reads `getAcknowledgement` every
 * two seconds while it is being prepared, and after a minute without an answer says it is taking
 * longer (with "Check again") instead of polling for ever. A failed slip can be asked for again,
 * with a cooldown between requests. The view (`slip-card.tsx`) runs the reads and requests.
 */

export const SLIP_POLL_INTERVAL_MS = 2000;
/** How long the card keeps polling before it says the slip is taking longer. */
export const SLIP_POLL_WINDOW_MS = 60_000;
/** Reads in one polling window: every two seconds for a minute. */
export const SLIP_POLL_LIMIT = SLIP_POLL_WINDOW_MS / SLIP_POLL_INTERVAL_MS;
/** How long "Request again" waits after a request, unless the service says (`Retry-After`). */
export const REISSUE_COOLDOWN_SECONDS = 60;

export type SlipState =
  /** Polling; `reads` so far in this window. */
  | { step: 'preparing'; reads: number; cooldownUntil: number | null }
  /** A window of reads went by with the slip still pending: stop, offer "Check again". */
  | { step: 'slow'; cooldownUntil: number | null }
  | { step: 'issued'; acknowledgement: Acknowledgement }
  /**
   * Issuance gave up. `cooldownUntil` (epoch ms) holds "Request again" back after a request;
   * `requesting` while one is in flight; `problem` when the last one did not go through.
   */
  | {
      step: 'failed';
      cooldownUntil: number | null;
      requesting: boolean;
      problem: 'error' | null;
    };

export type ReissueAnswer = ReissueOutcome | Unauthenticated;

export type SlipEvent =
  /** A `getAcknowledgement` answer; null when the read failed (counts as still pending). */
  | { type: 'read'; acknowledgement: Acknowledgement | null }
  | { type: 'check-again' }
  /** "Request again"; `now` to check the cooldown. */
  | { type: 'reissue-pressed'; now: number }
  | { type: 'reissue-answered'; answer: ReissueAnswer; now: number };

/** Where the card starts from the acknowledgement the page loaded. */
export function initialSlipState(acknowledgement: Acknowledgement): SlipState {
  switch (acknowledgement.status) {
    case 'issued':
      return { step: 'issued', acknowledgement };
    case 'failed':
      return { step: 'failed', cooldownUntil: null, requesting: false, problem: null };
    default:
      return { step: 'preparing', reads: 0, cooldownUntil: null };
  }
}

function preparing(cooldownUntil: number | null): SlipState {
  return { step: 'preparing', reads: 0, cooldownUntil };
}

/** Whole seconds left before "Request again" works again; 0 when it does. */
export function cooldownLeft(state: SlipState, now: number): number {
  if (state.step === 'issued' || state.cooldownUntil === null) return 0;
  return Math.max(0, Math.ceil((state.cooldownUntil - now) / 1000));
}

function read(state: SlipState, acknowledgement: Acknowledgement | null): SlipState {
  if (state.step === 'issued') {
    // A later read (e.g. for a download) brings a fresh verified count.
    return acknowledgement?.status === 'issued' ? { step: 'issued', acknowledgement } : state;
  }
  if (state.step !== 'preparing') return state;
  if (acknowledgement?.status === 'issued') return { step: 'issued', acknowledgement };
  if (acknowledgement?.status === 'failed') {
    return {
      step: 'failed',
      cooldownUntil: state.cooldownUntil,
      requesting: false,
      problem: null,
    };
  }
  const reads = state.reads + 1;
  return reads >= SLIP_POLL_LIMIT
    ? { step: 'slow', cooldownUntil: state.cooldownUntil }
    : { ...state, reads };
}

function answered(cooldownUntil: number | null, answer: ReissueAnswer, now: number): SlipState {
  switch (answer.status) {
    case 'requested':
      return preparing(now + REISSUE_COOLDOWN_SECONDS * 1000);
    case 'in-progress':
      // Issued or being prepared meanwhile: the next read says which.
      return preparing(cooldownUntil);
    case 'cooldown':
      return {
        step: 'failed',
        cooldownUntil: now + (answer.retryAfterSeconds ?? REISSUE_COOLDOWN_SECONDS) * 1000,
        requesting: false,
        problem: null,
      };
    default:
      return { step: 'failed', cooldownUntil, requesting: false, problem: 'error' };
  }
}

export function slipReducer(state: SlipState, event: SlipEvent): SlipState {
  switch (event.type) {
    case 'read':
      return read(state, event.acknowledgement);
    case 'check-again':
      return state.step === 'slow' ? preparing(state.cooldownUntil) : state;
    case 'reissue-pressed':
      return state.step === 'failed' && !state.requesting && cooldownLeft(state, event.now) === 0
        ? { ...state, requesting: true, problem: null }
        : state;
    case 'reissue-answered':
      return state.step === 'failed' && state.requesting
        ? answered(state.cooldownUntil, event.answer, event.now)
        : state;
  }
}

/** Copy of the slip card (spec 06 FE-3). */
export const SLIP_COPY = {
  preparing: 'Preparing your acknowledgement slip…',
  preparingHint: 'Usually a few seconds. We also email it to you.',
  slow: 'Still preparing your slip',
  slowHint: 'It is taking longer than usual. We will email you when it is ready.',
  checkAgain: 'Check again',
  failed: 'The slip could not be prepared.',
  failedHint: 'Your declaration is submitted and your reference is valid.',
  requestAgain: 'Request again',
  requestAgainIn: (seconds: number) => `Request again in ${String(seconds)}s`,
  requesting: 'Requesting…',
  reissueError: 'We could not ask for it again. Try again in a moment.',
  issued: 'Acknowledgement slip',
  ready: 'Your acknowledgement slip is ready.',
  signed: 'Digitally signed',
  reference: 'Reference',
  declarant: 'Declarant',
  commission: 'Commission',
  type: 'Type',
  statementDate: 'Statement date',
  version: 'Version',
  submitted: 'Submitted',
  late: 'late',
  verificationCode: 'Verification code',
  copyCode: 'Copy verification code',
  codeCopied: 'Verification code copied',
  qrLabel: (code: string) => `QR code for verification code ${code}`,
  scanHint: 'Scan to check it is genuine',
  sentTo: 'Sent to',
  and: 'and',
  verified: (count: number) => `Verified ${plural(count, 'time')}`,
  download: 'Download slip',
  downloadFailed: 'We could not download your slip. Try again.',
  verifyOnline: 'Verify online',
} as const;

export interface SentContact {
  kind: 'email' | 'phone';
  /** Masked on the server. */
  value: string;
}

/**
 * The contacts of "Sent to {masked email} and {masked phone}", with whichever the declarant has;
 * none leaves the line out.
 */
export function sentTo(maskedEmail: string | null, maskedPhone: string | null): SentContact[] {
  const contacts: SentContact[] = [];
  if (maskedEmail !== null) contacts.push({ kind: 'email', value: maskedEmail });
  if (maskedPhone !== null) contacts.push({ kind: 'phone', value: maskedPhone });
  return contacts;
}

/**
 * What the card's live region says when the slip changes state, so a screen reader hears each
 * change once and not every poll.
 */
export function slipAnnouncement(state: SlipState): string {
  switch (state.step) {
    case 'preparing':
      return SLIP_COPY.preparing;
    case 'slow':
      return SLIP_COPY.slowHint;
    case 'issued':
      return SLIP_COPY.ready;
    case 'failed':
      return state.problem === 'error' ? SLIP_COPY.reissueError : SLIP_COPY.failed;
  }
}
