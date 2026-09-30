/**
 * Event contracts the declarations service publishes about declarations (spec 06) that other
 * services read: the documents service issues the acknowledgement slip on submission, and review
 * (slice 07) opens its case. Identifiers, dates and flags only: no names, amounts or contents
 * (ADR-013 §3); consumers pull what else they need by version.
 */

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
  type: 'initial' | 'biennial' | 'final';
  statementDate: string;
  obligationId: string;
  /** Whether it is an amendment (version 2 or later). */
  amendment: boolean;
  /** Submitted after the obligation's due date. */
  late: boolean;
}
