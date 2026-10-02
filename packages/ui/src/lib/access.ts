import type { Tone } from './tone';
import type { Same } from './type-checks';

/**
 * The words for access requests (spec 10), shared by the portal and the console like the
 * obligations table: status words and tones, decision outcomes, the status sets the screens
 * branch on, and when a granted package that is not issued stops reading as being prepared.
 * The unions mirror `access.yaml`; the apps check their generated types against them.
 */
export type AccessRequestStatus =
  | 'submitted'
  | 'pending-applicant-verification'
  | 'officer-unresolved'
  | 'awaiting-representations'
  | 'under-decision'
  | 'granted'
  | 'partially-granted'
  | 'denied'
  | 'cannot-identify'
  | 'withdrawn';

/** A law enforcement request's status (Regs r.23). */
export type LeaRequestStatus = 'received' | 'verified' | 'granted' | 'denied' | 'withdrawn';

export type AccessOutcome = 'grant' | 'partial-grant' | 'deny';

/**
 * `true` when a contract's access unions (as an app's generated client names them) equal this
 * table's. Apps assert it, `Assert<MatchesAccessCopy<{ ... }>>`, so a contract value the table
 * lacks fails to compile.
 */
export type MatchesAccessCopy<C extends { status: string; leaStatus: string; outcome: string }> = [
  Same<C['status'], AccessRequestStatus>,
  Same<C['leaStatus'], LeaRequestStatus>,
  Same<C['outcome'], AccessOutcome>,
] extends [true, true, true]
  ? true
  : false;

/** One English string per key; the Swahili slot stays empty until EACC reviews translations. */
export const accessMessages = {
  submitted: 'Submitted',
  verifyApplicantIdentity: 'Verify applicant identity',
  awaitingIdentityVerification: 'Awaiting identity verification',
  identifyOfficer: 'Identify officer',
  officerBeingIdentified: 'Officer being identified',
  awaitingRepresentations: 'Awaiting representations',
  declarantNotified: 'Declarant notified',
  underDecision: 'Under decision',
  granted: 'Granted',
  partiallyGranted: 'Partially granted',
  denied: 'Denied',
  cannotIdentify: 'Cannot identify officer',
  withdrawn: 'Withdrawn',
  received: 'Received',
  verified: 'Verified',
  noPackage: 'No package has been issued for this grant.',
};

/** Swahili translations, key by key; empty until reviewed. */
export const accessMessagesSw: Partial<Record<keyof typeof accessMessages, string>> = {};

const m = accessMessages;

export interface AccessStatusMeta {
  label: string;
  tone: Tone;
}

/**
 * A Form K request's status as staff read it: the step the Commission takes next where it has
 * one ("Verify applicant identity", "Identify officer").
 */
export const accessStatusMeta: Record<AccessRequestStatus, AccessStatusMeta> = {
  submitted: { label: m.submitted, tone: 'info' },
  'pending-applicant-verification': { label: m.verifyApplicantIdentity, tone: 'warning' },
  'officer-unresolved': { label: m.identifyOfficer, tone: 'warning' },
  'awaiting-representations': { label: m.awaitingRepresentations, tone: 'default' },
  'under-decision': { label: m.underDecision, tone: 'brand' },
  granted: { label: m.granted, tone: 'success' },
  'partially-granted': { label: m.partiallyGranted, tone: 'success' },
  denied: { label: m.denied, tone: 'destructive' },
  'cannot-identify': { label: m.cannotIdentify, tone: 'default' },
  withdrawn: { label: m.withdrawn, tone: 'default' },
};

/**
 * A Form K request's status as its applicant reads it: what is happening, not what staff do.
 * Only the three steps that are the Commission's work read differently.
 */
export const applicantAccessStatusMeta: Record<AccessRequestStatus, AccessStatusMeta> = {
  ...accessStatusMeta,
  'pending-applicant-verification': { label: m.awaitingIdentityVerification, tone: 'warning' },
  'officer-unresolved': { label: m.officerBeingIdentified, tone: 'info' },
  'awaiting-representations': { label: m.declarantNotified, tone: 'info' },
};

/** A law enforcement request's status, the same words for its officer and the Commission. */
export const leaStatusMeta: Record<LeaRequestStatus, AccessStatusMeta> = {
  received: { label: m.received, tone: 'info' },
  verified: { label: m.verified, tone: 'brand' },
  granted: { label: m.granted, tone: 'success' },
  denied: { label: m.denied, tone: 'destructive' },
  withdrawn: { label: m.withdrawn, tone: 'default' },
};

/** A decision's outcome: "Granted", "Partially granted", "Denied". */
export const accessOutcomeLabels: Record<AccessOutcome, string> = {
  grant: m.granted,
  'partial-grant': m.partiallyGranted,
  deny: m.denied,
};

/** Form K statuses with a decision. */
export const DECIDED_ACCESS_STATUSES: ReadonlySet<AccessRequestStatus> = new Set([
  'granted',
  'partially-granted',
  'denied',
]);

/** Form K statuses whose decision released something: a package follows. */
export const GRANTED_ACCESS_STATUSES: ReadonlySet<AccessRequestStatus> = new Set([
  'granted',
  'partially-granted',
]);

/** Form K statuses before a decision or closure: the applicant can still withdraw. */
export const OPEN_ACCESS_STATUSES: ReadonlySet<AccessRequestStatus> = new Set([
  'submitted',
  'pending-applicant-verification',
  'officer-unresolved',
  'awaiting-representations',
  'under-decision',
]);

/**
 * How long after a grant a package that is not issued yet still reads as being prepared. The
 * access workflow renders, watermarks and signs it within minutes; a grant whose scope holds
 * nothing to disclose is never issued one (#259), and neither is one whose issuing failed.
 */
export const PACKAGE_PREPARING_FOR_MS = 60 * 60 * 1000;

/**
 * Where a granted request without a package stands at `now` (epoch milliseconds): `preparing`
 * within `PACKAGE_PREPARING_FOR_MS` of the decision, then `missing` ("No package has been
 * issued"). Every audience reads the same rule.
 */
export function unissuedPackageState(decidedAt: string, now: number): 'preparing' | 'missing' {
  return now - Date.parse(decidedAt) < PACKAGE_PREPARING_FOR_MS ? 'preparing' : 'missing';
}
