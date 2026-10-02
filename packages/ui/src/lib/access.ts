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
  nilLetter: 'Nil letter',
  nilLetterStatement: 'No declarations held within the granted scope.',
  packageFailed: 'The package could not be issued.',
};

/** Swahili translations, key by key; empty until reviewed. */
export const accessMessagesSw: Partial<Record<keyof typeof accessMessages, string>> = {};

const m = accessMessages;

/**
 * A decision's tint wherever it shows, for staff, applicants and declarants alike: granted
 * green, partially granted amber (part of what was asked was refused), denied red.
 */
export const accessOutcomeTones: Record<AccessOutcome, Tone> = {
  grant: 'success',
  'partial-grant': 'warning',
  deny: 'destructive',
};

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
  granted: { label: m.granted, tone: accessOutcomeTones.grant },
  'partially-granted': { label: m.partiallyGranted, tone: accessOutcomeTones['partial-grant'] },
  denied: { label: m.denied, tone: accessOutcomeTones.deny },
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
  granted: { label: m.granted, tone: accessOutcomeTones.grant },
  denied: { label: m.denied, tone: accessOutcomeTones.deny },
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
 * What a grant has delivered, as every audience reads it (spec 10, decision 1): its access
 * package, or the nil letter the Commission issues instead when the granted scope holds no
 * declaration; before either, `preparing` while the access service issues it, or `failed` once
 * issuing failed after its retries (the backend's `packageFailedAt`).
 */
export type GrantPackageStatus = 'preparing' | 'failed' | 'access-package' | 'nil-letter';

export function grantPackageStatus(
  pkg: { kind: 'access-package' | 'nil-letter' } | null,
  packageFailedAt: string | null,
): GrantPackageStatus {
  if (pkg) return pkg.kind;
  return packageFailedAt === null ? 'preparing' : 'failed';
}
