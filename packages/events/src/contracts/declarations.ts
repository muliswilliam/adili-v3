/**
 * Event contracts the declarations service publishes about declarations (spec 06) that other
 * services read: the documents service issues the acknowledgement slip on submission, and review
 * (slice 07) opens its case. Identifiers, dates and flags only: no names, amounts or contents
 * (ADR-013 §3); consumers pull what else they need by version.
 */
import type { DeclarationType } from '@adili/numbering/references';

/**
 * A declaration version was submitted: the legal act committed. Subject: the declaration; tenant:
 * its Commission. Idempotent consumers key on `versionId`.
 */
export const DECLARATION_SUBMITTED = 'declaration.submitted.v1';

export interface DeclarationSubmittedData extends Record<string, unknown> {
  declarationId: string;
  versionId: string;
  /** 1 for the first submission, then one more per amendment. */
  version: number;
  /** The reference number, allocated at version 1 and kept by later versions (ADR-011). */
  reference: string;
  type: DeclarationType;
  statementDate: string;
  obligationId: string;
  /** Whether it is an amendment (version 2 or later). */
  amendment: boolean;
  /** Submitted after the obligation's due date. */
  late: boolean;
}

/**
 * A version's acknowledgement slip was issued and set on it: the declarant can download it.
 * Subject: the declaration; tenant: its Commission.
 */
export const DECLARATION_ACKNOWLEDGED = 'declaration.acknowledged.v1';

export interface DeclarationAcknowledgedData extends Record<string, unknown> {
  declarationId: string;
  versionId: string;
  /** The issued slip in the documents service. */
  documentId: string;
  /** The verification code printed under its QR code. */
  verificationId: string;
}

/**
 * The declarant asked for a version's acknowledgement slip again, as its issuance did not come
 * through (spec 06 S11): the documents service issues it, or announces the slip it issued already.
 * Subject: the declaration; tenant: its Commission. Idempotent consumers key on the event id, as
 * each request is a new ask.
 */
export const DECLARATION_ACKNOWLEDGEMENT_REQUESTED = 'declaration.acknowledgement-requested.v1';

export interface DeclarationAcknowledgementRequestedData extends Record<string, unknown> {
  declarationId: string;
  versionId: string;
  version: number;
  /** The reference number of the declaration (ADR-011). */
  reference: string;
}
