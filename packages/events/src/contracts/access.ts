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

/**
 * The steps the access register records, each shown in request timelines (access.yaml
 * `RegisterEntry.kind`). `identified`: the access officer resolved the officer a Form K names to a
 * roster record.
 */
export const ACCESS_REGISTER_KINDS = [
  'received',
  'verified',
  'identified',
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

/**
 * The event each step of a Form K request publishes, by register kind: `access.request.<kind>.v1`.
 * Every kind a Form K request records is here, and nothing else (no self-access step).
 */
export const ACCESS_REQUEST_EVENTS = {
  received: 'access.request.received.v1',
  verified: 'access.request.verified.v1',
  identified: 'access.request.identified.v1',
  notified: 'access.request.notified.v1',
  representations: 'access.request.representations.v1',
  decided: 'access.request.decided.v1',
  'package-issued': 'access.request.package-issued.v1',
  downloaded: 'access.request.downloaded.v1',
  expired: 'access.request.expired.v1',
  withdrawn: 'access.request.withdrawn.v1',
  'cannot-identify': 'access.request.cannot-identify.v1',
} as const satisfies { [K in AccessRegisterKind]?: `access.request.${K}.v1` };
export type AccessRequestEventKind = keyof typeof ACCESS_REQUEST_EVENTS;

/**
 * The event each step of a law enforcement request publishes, by register kind:
 * `lea.request.<kind>.v1`. No representations (the declarant is told only after a grant, r.23(2))
 * and no cannot-identify.
 */
export const LEA_REQUEST_EVENTS = {
  received: 'lea.request.received.v1',
  verified: 'lea.request.verified.v1',
  notified: 'lea.request.notified.v1',
  decided: 'lea.request.decided.v1',
  'package-issued': 'lea.request.package-issued.v1',
  downloaded: 'lea.request.downloaded.v1',
  expired: 'lea.request.expired.v1',
  withdrawn: 'lea.request.withdrawn.v1',
} as const satisfies { [K in AccessRegisterKind]?: `lea.request.${K}.v1` };
export type LeaRequestEventKind = keyof typeof LEA_REQUEST_EVENTS;

export const ACCESS_REQUEST_RECEIVED = ACCESS_REQUEST_EVENTS.received;
export const ACCESS_REQUEST_VERIFIED = ACCESS_REQUEST_EVENTS.verified;
export const ACCESS_REQUEST_IDENTIFIED = ACCESS_REQUEST_EVENTS.identified;
export const ACCESS_REQUEST_NOTIFIED = ACCESS_REQUEST_EVENTS.notified;
export const ACCESS_REQUEST_REPRESENTATIONS = ACCESS_REQUEST_EVENTS.representations;
export const ACCESS_REQUEST_DECIDED = ACCESS_REQUEST_EVENTS.decided;
export const ACCESS_REQUEST_PACKAGE_ISSUED = ACCESS_REQUEST_EVENTS['package-issued'];
export const ACCESS_REQUEST_DOWNLOADED = ACCESS_REQUEST_EVENTS.downloaded;
export const ACCESS_REQUEST_EXPIRED = ACCESS_REQUEST_EVENTS.expired;
export const ACCESS_REQUEST_WITHDRAWN = ACCESS_REQUEST_EVENTS.withdrawn;
export const ACCESS_REQUEST_CANNOT_IDENTIFY = ACCESS_REQUEST_EVENTS['cannot-identify'];

export const LEA_REQUEST_RECEIVED = LEA_REQUEST_EVENTS.received;
export const LEA_REQUEST_VERIFIED = LEA_REQUEST_EVENTS.verified;
export const LEA_REQUEST_NOTIFIED = LEA_REQUEST_EVENTS.notified;
export const LEA_REQUEST_DECIDED = LEA_REQUEST_EVENTS.decided;
export const LEA_REQUEST_PACKAGE_ISSUED = LEA_REQUEST_EVENTS['package-issued'];
export const LEA_REQUEST_DOWNLOADED = LEA_REQUEST_EVENTS.downloaded;
export const LEA_REQUEST_EXPIRED = LEA_REQUEST_EVENTS.expired;
export const LEA_REQUEST_WITHDRAWN = LEA_REQUEST_EVENTS.withdrawn;

/** A self-access step (a certified copy issued) publishes this. */
export const ACCESS_CERTIFIED_COPY_ISSUED = 'access.certified-copy.issued.v1';

/** Every event type the access service publishes. */
export const ACCESS_EVENT_TYPES = [
  ...Object.values(ACCESS_REQUEST_EVENTS),
  ...Object.values(LEA_REQUEST_EVENTS),
  ACCESS_CERTIFIED_COPY_ISSUED,
] as const;
export type AccessEventType =
  | (typeof ACCESS_REQUEST_EVENTS)[AccessRequestEventKind]
  | (typeof LEA_REQUEST_EVENTS)[LeaRequestEventKind]
  | typeof ACCESS_CERTIFIED_COPY_ISSUED;

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
 * `access.request.identified.v1`: the access officer (the actor) resolved the officer named in
 * Form K to a roster record of the Commission, whose person is now the entry's `personId`.
 */
export interface AccessRequestIdentifiedData extends AccessRegisterEventData {
  kind: 'identified';
  rosterRecordId: string;
}

/**
 * How the declarant was told of a request: `online` (the service's message to their account), or
 * `written` (r.22(2): the access officer served a written notice on an officer with no account,
 * and recorded the date it was served).
 */
export const NOTICE_CHANNELS = ['online', 'written'] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];

/**
 * How the declarant was told: online (the service, no actor), or in writing on `notifiedOn` (the
 * access officer who recorded it is the entry's actor).
 */
export interface DeclarantNoticeFacts {
  channel: NoticeChannel;
  /** `YYYY-MM-DD` (Nairobi): the day a written notice was served; null when told online. */
  notifiedOn: string | null;
}

/**
 * `access.request.notified.v1`: the declarant was told of the request (Act s.36(3)); their window
 * for representations ends at `windowEndsAt`.
 */
export interface AccessRequestNotifiedData extends AccessRegisterEventData, DeclarantNoticeFacts {
  kind: 'notified';
  /** ISO 8601. */
  windowEndsAt: string;
}

/**
 * `lea.request.notified.v1`: the declarant was told of a grant (r.23(2)), online or in writing; no
 * window opens.
 */
export interface LeaRequestNotifiedData extends AccessRegisterEventData, DeclarantNoticeFacts {
  kind: 'notified';
}

/**
 * `access.request.representations.v1`: the declarant's representations were made or changed,
 * by the declarant online, or `receivedInWriting` and entered by the access officer (the actor)
 * on their behalf.
 */
export interface AccessRequestRepresentationsData extends AccessRegisterEventData {
  kind: 'representations';
  receivedInWriting: boolean;
}

/**
 * `access.request.package-issued.v1` / `lea.request.package-issued.v1`: the recipient's
 * Confidential package was issued; downloadable until `downloadExpiresAt`.
 */
export interface AccessPackageIssuedData extends AccessRegisterEventData {
  kind: 'package-issued';
  documentId: string;
  /** ISO 8601. */
  downloadExpiresAt: string;
}

/** `access.request.downloaded.v1` / `lea.request.downloaded.v1`: the package was downloaded. */
export interface AccessPackageDownloadedData extends AccessRegisterEventData {
  kind: 'downloaded';
  documentId: string;
}

/**
 * `access.request.expired.v1` / `lea.request.expired.v1`: the package's download window ended
 * (the request is closed).
 */
export interface AccessPackageExpiredData extends AccessRegisterEventData {
  kind: 'expired';
  documentId: string;
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
