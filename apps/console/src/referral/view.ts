import { formatNumber } from '@adili/ui';

import type {
  Assignee,
  CaseListItem,
  Clarification,
  Flag,
  Referral,
  ReferralGrounds,
  ReferralInput,
  ReferralManifestKind,
  ReferralStatus,
} from '../server/review/types';

/**
 * What the referral screens derive from review.yaml's `Referral` and a case (spec 08 FE-6; S12,
 * S13): which flags and clarifications a referral can rest on, the Refer to EACC dialog's
 * checks, and where a referral stands for the viewer. Pure, so the screens and tests share it.
 */

/** review.yaml `ReferralGrounds`: every ground a referral rests on. */
export const REFERRAL_GROUNDS = [
  'undeclared-assets',
  'unexplained-assets',
  'two-missed-cycles',
  'unanswered-clarification',
] as const satisfies readonly ReferralGrounds[];

/** The grounds a reviewer refers a case on (`ReferralInput.grounds`); the system proposes the rest. */
export const ASSETS_GROUNDS = [
  'undeclared-assets',
  'unexplained-assets',
] as const satisfies readonly ReferralInput['grounds'][];

/** review.yaml `ReferralStatus`, in the order the list filters them. */
export const REFERRAL_STATUSES = [
  'proposed',
  'approved',
  'sent',
  'declined',
] as const satisfies readonly ReferralStatus[];

/** review.yaml `ReferralInput.narrative`. */
export const NARRATIVE_MAX_LENGTH = 8000;
/** review.yaml `ReferralInput.flagIds` and `clarificationIds`. */
export const MAX_FLAGS = 100;
export const MAX_CLARIFICATIONS = 50;

/**
 * Where review cuts a referral's narrative for the approvals inbox (`NARRATIVE_EXCERPT` in
 * services/review `referral-approvals.ts`; `service-rules.test.ts` keeps the two equal).
 */
export const NARRATIVE_EXCERPT = 200;

/** review.yaml `ReasonInput.reason`, the supervisor's note when declining. */
export const DECLINE_NOTE_MAX_LENGTH = 2000;

/**
 * The flags an assets referral rests on, each with what its rule found as the referral names it:
 * the registry cross-checks (spec 07b) and the comparisons with the previous declaration that
 * point at undeclared or unexplained assets, as the review service checks them (`ASSET_RULES` in
 * services/review, a 400 for any other; `service-rules.test.ts` keeps the two equal).
 */
export const ASSET_RULE_LABELS = {
  'value-change-25': 'Value changed by more than 25%',
  'acquisition-unflagged': 'New item not marked as acquired',
  'disposal-unflagged': 'Item gone without a disposal mark',
  'change-flag-mismatch': 'Change mark does not match the values',
  'income-vs-asset-growth': 'Assets grew faster than income',
  'nil-after-populated': 'Nil where items were declared before',
  'registry-parcel-undeclared': 'Land parcel not declared',
  'declared-parcel-not-found': 'Declared parcel not found in the registry',
  'registry-vehicle-undeclared': 'Motor vehicle not declared',
  'declared-vehicle-not-found': 'Declared vehicle not found in the registry',
  'registry-directorship-undeclared': 'Company directorship not declared',
  'declared-company-not-found': 'Declared company not found in the registry',
  'directorship-employer-supplier': 'Directorship of a supplier to the employer',
} as const satisfies Partial<Record<Flag['ruleId'], string>>;

type AssetRule = keyof typeof ASSET_RULE_LABELS;

export const ASSET_RULES: ReadonlySet<string> = new Set(Object.keys(ASSET_RULE_LABELS));

function isAssetRule(value: string): value is AssetRule {
  return ASSET_RULES.has(value);
}

/** The case's flags a referral can include: asset flags that still count. */
export function referableFlags<F extends Flag>(flags: F[]): F[] {
  return flags.filter((flag) => ASSET_RULES.has(flag.ruleId) && !flag.closedReason);
}

/**
 * Whether the viewer may refer the case to EACC: its assignee, while the case is not determined
 * and has a flag a referral can rest on. The case's Refer to EACC and the propose dialog's Start
 * referral (#610) both follow it.
 */
export function referralOffered(
  item: Pick<CaseListItem, 'status' | 'assignee'>,
  flags: Flag[],
  viewer: Pick<Assignee, 'subject'>,
): boolean {
  return (
    item.assignee?.subject === viewer.subject &&
    item.status !== 'determined' &&
    referableFlags(flags).length > 0
  );
}

/** The clarifications a referral can include: every issued one, not drafts or withdrawn ones. */
export function referableClarifications(clarifications: Clarification[]): Clarification[] {
  return clarifications.filter(
    (each) => each.reference !== null && each.status !== 'draft' && each.status !== 'withdrawn',
  );
}

export interface ReferralForm {
  grounds: ReferralInput['grounds'] | null;
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
  // review.yaml: 1 to 100 flags, up to 50 clarifications.
  if (form.flagIds.length === 0) {
    errors.evidence = 'Select at least one flag that supports the referral.';
  } else if (form.flagIds.length > MAX_FLAGS) {
    errors.evidence = `Select up to ${formatNumber(MAX_FLAGS)} flags.`;
  } else if (form.clarificationIds.length > MAX_CLARIFICATIONS) {
    errors.evidence = `Select up to ${formatNumber(MAX_CLARIFICATIONS)} clarifications.`;
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

/**
 * An evidence item as the referral screens read it: a flag by what its rule found, with its
 * case's reference beside it (review references a flag as `<case reference> <rule id>`); an
 * obligation by its type and cycle; anything else by its reference.
 */
export function evidenceLabel(
  kind: ReferralManifestKind,
  reference: string,
): { text: string; detail: string | null } {
  if (kind === 'obligation') return { text: obligationLabel(reference), detail: null };
  if (kind === 'flag') {
    const [caseReference, rule] = reference.split(' ');
    if (caseReference && rule && isAssetRule(rule)) {
      return { text: ASSET_RULE_LABELS[rule], detail: caseReference };
    }
  }
  return { text: reference, detail: null };
}
