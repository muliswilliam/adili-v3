/**
 * Event contracts verification-api publishes (ADR-010, spec 06), read by declarations (the
 * "verified n times" count of an acknowledgement) and audit. Identifiers and the outcome only:
 * nothing about who checked.
 */
import { DOCUMENT_STATUSES } from './documents.js';

/** What a lookup answered: the document's status, or `not-found` for an unknown code. */
export const VERIFICATION_OUTCOMES = [...DOCUMENT_STATUSES, 'not-found'] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

/**
 * A verification code was looked up on the public verify API. Subject: the verification id (in
 * its printed form); no tenant, as verification-api holds no tenant.
 */
export const VERIFICATION_CHECKED = 'verification.checked.v1';

export interface VerificationCheckedData extends Record<string, unknown> {
  verificationId: string;
  outcome: VerificationOutcome;
}
