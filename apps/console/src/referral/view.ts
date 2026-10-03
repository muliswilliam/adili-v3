import { formatNumber } from '@adili/ui';

import type { Assignee, Clarification, Flag, Referral } from '../server/review/types';

/**
 * What the referral screens derive from review.yaml's `Referral` and a case (spec 08 FE-6; S12,
 * S13): which flags and clarifications a referral can rest on, the Refer to EACC dialog's
 * checks, and where a referral stands for the viewer. Pure, so the screens and tests share it.
 */

/** review.yaml `ReferralInput.narrative`. */
export const NARRATIVE_MAX_LENGTH = 8000;
/** review.yaml `ReasonInput.reason`, the supervisor's note when declining. */
export const DECLINE_NOTE_MAX_LENGTH = 2000;

/**
 * The flags an assets referral rests on: the registry cross-checks (spec 07b) and the
 * comparisons with the previous declaration that point at undeclared or unexplained assets, as
 * the review service checks them (`ASSET_RULES` in services/review, a 400 for any other).
 */
export const ASSET_RULES: ReadonlySet<Flag['ruleId']> = new Set<Flag['ruleId']>([
  'value-change-25',
  'acquisition-unflagged',
  'disposal-unflagged',
  'change-flag-mismatch',
  'income-vs-asset-growth',
  'nil-after-populated',
  'registry-parcel-undeclared',
  'declared-parcel-not-found',
  'registry-vehicle-undeclared',
  'declared-vehicle-not-found',
  'registry-directorship-undeclared',
  'declared-company-not-found',
  'directorship-employer-supplier',
]);

/** The case's flags a referral can include: asset flags that still count. */
export function referableFlags<F extends Flag>(flags: F[]): F[] {
  return flags.filter((flag) => ASSET_RULES.has(flag.ruleId) && !flag.closedReason);
}

/** The clarifications a referral can include: every issued one, not drafts or withdrawn ones. */
export function referableClarifications(clarifications: Clarification[]): Clarification[] {
  return clarifications.filter(
    (each) => each.reference !== null && each.status !== 'draft' && each.status !== 'withdrawn',
  );
}

export interface ReferralForm {
  grounds: 'undeclared-assets' | 'unexplained-assets' | null;
  flagIds: string[];
  clarificationIds: string[];
  narrative: string;
}

export interface ReferralErrors {
  grounds?: string;
  evidence?: string;
  narrative?: string;
}

/** What is wrong with the dialog's answers; empty when it can be sent. */
export function referralErrors(form: ReferralForm): ReferralErrors {
  const errors: ReferralErrors = {};
  if (form.grounds === null) errors.grounds = 'Choose the grounds.';
  // review.yaml: 1 to 100 flags; clarifications are optional.
  if (form.flagIds.length === 0) {
    errors.evidence = 'Select at least one flag that supports the referral.';
  }
  if (!form.narrative.trim()) errors.narrative = 'Enter the narrative.';
  else if (form.narrative.length > NARRATIVE_MAX_LENGTH) {
    errors.narrative = `The narrative can be up to ${formatNumber(NARRATIVE_MAX_LENGTH)} characters.`;
  }
  return errors;
}

/**
 * Where a referral stands: `assembling` between approval and sending, while review builds the
 * evidence package in the background.
 */
export type ReferralPhase = 'proposed' | 'assembling' | 'sent' | 'declined';

export function referralPhase(referral: Pick<Referral, 'status'>): ReferralPhase {
  return referral.status === 'approved' ? 'assembling' : referral.status;
}

/** The page's title: the RFL reference once allocated, else where it stands. */
export function referralTitle(referral: Pick<Referral, 'status' | 'reference'>): string {
  if (referral.reference) return referral.reference;
  return referral.status === 'declined' ? 'Declined referral' : 'Proposed referral';
}

/**
 * What the approval card offers the viewer: Approve and Decline (`decide`); why not (`proposer`,
 * `role`); or the decision made. A reviewer of record is told by review's 403 when they try:
 * the referral does not list its reviewers of record.
 */
export type ApprovalPanel = 'decide' | 'proposer' | 'role' | 'decided';

export function approvalPanel(
  referral: Pick<Referral, 'status' | 'proposer'>,
  viewer: Assignee,
  supervisor: boolean,
): ApprovalPanel {
  if (referral.status !== 'proposed') return 'decided';
  if (referral.proposer?.subject === viewer.subject) return 'proposer';
  return supervisor ? 'decide' : 'role';
}

const OBLIGATION_TYPES: Record<string, string> = {
  initial: 'Initial',
  biennial: 'Biennial',
  final: 'Final',
};

/** An obligation by its cycle key (`biennial:2024`): "Biennial declaration 2024". */
export function obligationLabel(cycleKey: string): string {
  const [type, period] = cycleKey.split(':');
  const label = type ? OBLIGATION_TYPES[type] : undefined;
  return label && period ? `${label} declaration ${period}` : cycleKey;
}
