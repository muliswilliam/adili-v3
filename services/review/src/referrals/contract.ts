/**
 * What passes between the referral workflows (`ReferralSweep`, the sending of an approved
 * referral), their activities and the code that starts them. Bundled into the workflow sandbox:
 * types and constants only.
 *
 * Identifiers, counts and outcomes only: no names, references, grounds text, narratives, evidence
 * or hashes enter Temporal's history. The activities read what they use from the database and
 * from declarations and documents.
 */

/** Workflow type names, for starting by name (the worker bundles the code, not the caller). */
export const REFERRAL_SWEEPS_WORKFLOW = 'referralSweeps';
export const REFERRAL_SWEEP_WORKFLOW = 'referralSweep';
export const REFERRAL_SENDING_WORKFLOW = 'referralSending';

/** The Temporal schedule that starts `referralSweeps` daily, one per task queue. */
export function referralSweepScheduleId(taskQueue: string): string {
  return `referral-sweep-schedule:${taskQueue}`;
}

/** `ReferralSweep(tenant)` (spec 08), one child run per Commission per day. */
export function referralSweepWorkflowId(tenant: string, runDate: string): string {
  return `referral-sweep:${tenant}:${runDate}`;
}

/** One sending per approved referral. */
export function referralSendingWorkflowId(referralId: string): string {
  return `referral-sending:${referralId}`;
}

/** What `referralSweepTenants` answers: the Commissions with ladders, and the run's date. */
export interface ReferralSweepPlan {
  tenants: string[];
  /** Nairobi date of the run, `YYYY-MM-DD`: part of the child workflow ids. */
  runDate: string;
}

export interface ReferralSweepInput {
  tenant: string;
  /** Carried across continue-as-new: where the two-missed-cycles pass resumes, and its count. */
  after?: string | null;
  twoMissedCycles?: number;
}

/**
 * The persons of a Commission the sweep looks at for two missed cycles: those with a ladder on
 * an overdue obligation and no system proposal of that grounds yet, a page at a time.
 */
export interface MissedCyclesCandidates {
  personIds: string[];
  /** Pass back as `after` for the next page; null on the last. */
  next: string | null;
}

export interface MissedCyclesPage {
  tenant: string;
  after: string | null;
  limit: number;
}

export interface PersonRef {
  tenant: string;
  personId: string;
}

/**
 * What the sweep did for one person: `proposed` a referral, found one `already-proposed` for that
 * cycle, or found `none` owed (fewer than two consecutive missed cycles, or the ladder window not
 * yet past).
 */
export type MissedCyclesOutcome = 'proposed' | 'already-proposed' | 'none';

/** One chunk of the unanswered-clarification pass. */
export interface ClarificationSweepChunk {
  tenant: string;
  limit: number;
}

/** What one chunk did: the clarifications it looked at, and the referrals it proposed. */
export interface ClarificationSweepResult {
  scanned: number;
  proposed: number;
}

export interface ReferralSweepCounts {
  twoMissedCycles: number;
  unansweredClarifications: number;
}

/** The approved referral, from the approval transaction. */
export interface ReferralSendingInput {
  tenant: string;
  referralId: string;
}

/**
 * What `buildManifest` did: pulled the evidence and stored the manifest (`built`), found it
 * `already-built` (a retried or repeated run), or found the referral `not-approved` yet (the
 * workflow is started inside the approval transaction, so its first attempt can run before that
 * commits). `items` counts the manifest's entries.
 */
export type ManifestOutcome =
  { outcome: 'built' | 'already-built'; items: number } | { outcome: 'not-approved' };

/** What `issuePackage` did: asked documents for the package, or found it already issued. */
export type PackageOutcome = 'issued' | 'already-issued';

/** What `markSent` did: sent it now, or found it sent already. */
export type SentOutcome = 'sent' | 'already-sent';

/** How a sending ended. */
export type ReferralSendingResult =
  { outcome: 'sent'; items: number } | { outcome: 'not-approved' };

/** Failure type of a referral that disappeared; not retried. */
export const REFERRAL_MISSING = 'referral-missing';

/** Failure type of a package the documents service refused; not retried. */
export const PACKAGE_REFUSED = 'referral-package-refused';

/** Failure type of evidence the declarations service no longer holds; not retried. */
export const EVIDENCE_MISSING = 'referral-evidence-missing';
