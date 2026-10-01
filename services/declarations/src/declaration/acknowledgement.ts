import type { Acknowledgement } from './representation.js';
import type { AcknowledgementStatus, declarationVersions } from './schema.js';

/**
 * How long issuing a slip may take before the declarant is told it failed and may ask again
 * (spec 06 S11): the portal's polling cut-off. A slip normally comes within seconds; the
 * documents service's two attempts at a cold Gotenberg and OpenBao fit. The version's stored
 * acknowledgement stays `pending` meanwhile (a dead-lettered issuance changes nothing);
 * `failed` is what the API reports once the time is up.
 */
export const ACKNOWLEDGEMENT_DEADLINE_MS = 60 * 1000;

/** The acknowledgement columns of a version the rules read. */
export interface AcknowledgementState {
  ackStatus: AcknowledgementStatus;
  submittedAt: Date;
  /** When the declarant last asked for the slip again; null until they do. */
  ackRequestedAt: Date | null;
}

/**
 * The status the declarant sees: `issued` once the slip is set on the version; `pending` while it
 * is within `ACKNOWLEDGEMENT_DEADLINE_MS` of the submission, or of the last ask again; `failed`
 * after that, when it may be asked for again.
 */
export function acknowledgementStatus(
  state: AcknowledgementState,
  now: Date,
): AcknowledgementStatus {
  if (state.ackStatus !== 'pending') return state.ackStatus;
  return now.getTime() - lastAsked(state).getTime() > ACKNOWLEDGEMENT_DEADLINE_MS
    ? 'failed'
    : 'pending';
}

/** Whether the slip may be asked for again now, and if not, why. */
export type ReissueDecision =
  | { kind: 'reissue' }
  | { kind: 'refused'; code: 'acknowledgement-issued' | 'acknowledgement-in-progress' }
  /** Asked again already, and that ask is still within its time: wait `retryAfterSeconds`. */
  | { kind: 'cooldown'; retryAfterSeconds: number };

export function reissueDecision(state: AcknowledgementState, now: Date): ReissueDecision {
  const status = acknowledgementStatus(state, now);
  if (status === 'issued') return { kind: 'refused', code: 'acknowledgement-issued' };
  if (status === 'failed') return { kind: 'reissue' };
  if (state.ackRequestedAt === null) {
    return { kind: 'refused', code: 'acknowledgement-in-progress' };
  }
  const remainingMs = state.ackRequestedAt.getTime() + ACKNOWLEDGEMENT_DEADLINE_MS - now.getTime();
  return { kind: 'cooldown', retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

/** The acknowledgement as the contract shows it: its status as the declarant sees it now. */
export function acknowledgementOf(
  row: typeof declarationVersions.$inferSelect,
  now: Date,
): Acknowledgement {
  return {
    status: acknowledgementStatus(row, now),
    documentId: row.ackDocumentId,
    verificationId: row.ackVerificationId,
    verifyUrl: row.ackVerifyUrl,
    issuedAt: row.ackIssuedAt?.toISOString() ?? null,
    verifiedCount: row.verifiedCount,
    // The portal downloads the slip from the documents service by its id (the owner's
    // presigned link, audited there).
    downloadUrl: null,
  };
}

function lastAsked(state: AcknowledgementState): Date {
  return state.ackRequestedAt && state.ackRequestedAt > state.submittedAt
    ? state.ackRequestedAt
    : state.submittedAt;
}
