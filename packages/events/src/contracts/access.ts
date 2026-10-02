import type { ReadLegalBasisCode } from '@adili/api-kit';

/**
 * Event contracts the access service publishes (spec 10, Act s.36, ADR-008 access register): one
 * event per access-register entry, read by the audit service (every entry, with its legal basis)
 * and the reporting service (Form M section 5: requests received and decided, with outcome and
 * grounds). Identifiers, references, outcomes and grounds only: never the applicant's
 * particulars, the Form K text, the reasons given or any declaration content.
 */

/**
 * The law each access-register entry rests on: Act s.36(1) for Form K requests, s.36(2) with
 * Regulation 23 for law enforcement requests, `self-access` (Administrative Mechanism 32) for a
 * declarant's access to their own declaration (certified copies). The same words the audit
 * trail's reads use (api-kit `READ_LEGAL_BASES`, ADR-008).
 */
export const ACCESS_LEGAL_BASES = [
  'act-s36-1',
  'act-s36-2',
  'self-access',
] as const satisfies readonly ReadLegalBasisCode[];
export type AccessLegalBasis = (typeof ACCESS_LEGAL_BASES)[number];

/** What an access-register entry is about. */
export const ACCESS_SUBJECT_KINDS = ['access-request', 'lea-request', 'self-access'] as const;
export type AccessSubjectKind = (typeof ACCESS_SUBJECT_KINDS)[number];

/** The steps the access register records (access.yaml `RegisterEntry.kind`). */
export const ACCESS_REGISTER_KINDS = [
  'received',
  'verified',
  'notified',
  'representations',
  'decided',
  'package-issued',
  'downloaded',
  'expired',
  'withdrawn',
  'cannot-identify',
  'self-access',
] as const;
export type AccessRegisterKind = (typeof ACCESS_REGISTER_KINDS)[number];

/** An access officer's decision on a request (access.yaml `Outcome`); final. */
export const ACCESS_OUTCOMES = ['grant', 'partial-grant', 'deny'] as const;
export type AccessOutcome = (typeof ACCESS_OUTCOMES)[number];

/** Regulation 24 grounds for refusing access (access.yaml `Ground`). */
export const ACCESS_GROUNDS = [
  'public-interest',
  'prejudice-proceeding',
  'frivolous-vexatious',
  'not-objectives',
] as const;
export type AccessGround = (typeof ACCESS_GROUNDS)[number];

/**
 * The Form M decline reason a request closed as `cannot-identify` counts under (Form M
 * `DECLINE_REASONS`): the Regulation 24 grounds do not cover it.
 */
export const CANNOT_IDENTIFY_DECLINE_REASON = 'other';

export const ACCESS_REQUEST_RECEIVED = 'access.request.received.v1';
export const ACCESS_REQUEST_VERIFIED = 'access.request.verified.v1';
export const ACCESS_REQUEST_NOTIFIED = 'access.request.notified.v1';
export const ACCESS_REQUEST_REPRESENTATIONS = 'access.request.representations.v1';
export const ACCESS_REQUEST_DECIDED = 'access.request.decided.v1';
export const ACCESS_REQUEST_PACKAGE_ISSUED = 'access.request.package-issued.v1';
export const ACCESS_REQUEST_DOWNLOADED = 'access.request.downloaded.v1';
export const ACCESS_REQUEST_EXPIRED = 'access.request.expired.v1';
export const ACCESS_REQUEST_WITHDRAWN = 'access.request.withdrawn.v1';
export const ACCESS_REQUEST_CANNOT_IDENTIFY = 'access.request.cannot-identify.v1';

export const LEA_REQUEST_RECEIVED = 'lea.request.received.v1';
export const LEA_REQUEST_VERIFIED = 'lea.request.verified.v1';
export const LEA_REQUEST_DECIDED = 'lea.request.decided.v1';
export const LEA_REQUEST_PACKAGE_ISSUED = 'lea.request.package-issued.v1';
export const LEA_REQUEST_DOWNLOADED = 'lea.request.downloaded.v1';

export const ACCESS_CERTIFIED_COPY_ISSUED = 'access.certified-copy.issued.v1';

/**
 * The data of every access event: the register entry it reports. The CloudEvents `tenant`
 * extension is the Responsible Commission whose declarant the entry is about, and the subject the
 * request (or certified copy) id.
 */
export interface AccessRegisterEventData extends Record<string, unknown> {
  registerEntryId: string;
  subjectKind: AccessSubjectKind;
  /** The access request, law enforcement request or certified copy. */
  subjectId: string;
  /** Its `ARQ` or `LEA` reference; null for a certified copy. */
  reference: string | null;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  kind: AccessRegisterKind;
  legalBasis: AccessLegalBasis;
  /**
   * The declarant whose declaration the request is about, once the officer named in it is
   * resolved to a roster record; null before.
   */
  personId: string | null;
  /** Token subject of who acted; null for the service's own steps (expiry, notification). */
  actor: string | null;
  /** ISO 8601. */
  at: string;
}

/** `access.request.received.v1` / `lea.request.received.v1`: received, with its legal deadline. */
export interface AccessRequestReceivedData extends AccessRegisterEventData {
  kind: 'received';
  /** ISO 8601: received + 30 days (Form K) or + 14 days (law enforcement). */
  decisionDeadlineAt: string;
}

/**
 * `access.request.decided.v1` / `lea.request.decided.v1`: the final decision, with the
 * Regulation 24 grounds of a denial or partial grant (empty for a full grant), for Form M
 * section 5.
 */
export interface AccessRequestDecidedData extends AccessRegisterEventData {
  kind: 'decided';
  outcome: AccessOutcome;
  grounds: AccessGround[];
}

/**
 * `access.request.cannot-identify.v1`: the officer named in Form K matches no roster record of
 * the Commission, so the request closes; Form M counts it declined for reason `other`.
 */
export interface AccessRequestCannotIdentifyData extends AccessRegisterEventData {
  kind: 'cannot-identify';
  declineReason: typeof CANNOT_IDENTIFY_DECLINE_REASON;
}

/**
 * `access.certified-copy.issued.v1`: a declarant's certified copy of a submitted version was
 * issued (Administrative Mechanism 32, self-access), online or from a written application the
 * access officer recorded. The subject is the certified copy.
 */
export interface AccessCertifiedCopyIssuedData extends AccessRegisterEventData {
  subjectKind: 'self-access';
  kind: 'self-access';
  declarationId: string;
  version: number;
  /** The Restricted `certified-copy` document. */
  documentId: string;
  /** The officer-recorded application it was issued for; null when the declarant asked online. */
  applicationId: string | null;
}
