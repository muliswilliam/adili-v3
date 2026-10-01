/**
 * Event contracts verification-api publishes (ADR-010, spec 06). `verification.checked.v1` is read
 * by declarations (the "verified n times" count of an acknowledgement): identifiers and the outcome
 * only, nothing about who checked. `audit.verification.v1` is for the audit trail alone and adds
 * the lookup's coarse origin.
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

/**
 * A lookup, for the audit trail (ADR-010 §5: every verification is audited with its time and
 * coarse origin). The time is the envelope's; subject: the verification id; tenant: `platform`
 * (ADR-008 chains platform events apart from any Commission's). Consumed by audit only, so the
 * origin never reaches the declarant's record.
 */
export const VERIFICATION_AUDITED = 'audit.verification.v1';

export interface VerificationAuditedData extends Record<string, unknown> {
  verificationId: string;
  outcome: VerificationOutcome;
  origin: {
    /**
     * The network the lookup came from, never the address: the IPv4 /24 (`203.0.113.0/24`) or
     * IPv6 /48 (`2001:db8:abcd::/48`); null when the address is unknown.
     */
    network: string | null;
  };
}
