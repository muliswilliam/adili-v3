import { z } from 'zod';

import type { ApprovalKind } from '../server/review/types';

/**
 * The kinds of approval the inbox shows (spec 08 FE-3) and how each one's summary reads.
 * review.yaml types `ApprovalItem.summary` as an open object, one shape per kind. Shared by the
 * server functions and the inbox, so not a `.server` module. Adding a kind: see
 * `components/approvals/kinds.tsx`.
 */

/** Every kind review.yaml's `ApprovalKind` has, shown or not, for counts and reassigning. */
export const APPROVAL_KINDS = [
  'determination',
  'action',
  'referral',
] as const satisfies readonly ApprovalKind[];

/** The kinds the inbox shows so far, in tab order; the first is the default tab. */
export const INBOX_KINDS = ['determination', 'referral'] as const satisfies readonly ApprovalKind[];

export type InboxKind = (typeof INBOX_KINDS)[number];

export const DEFAULT_INBOX_KIND: InboxKind = INBOX_KINDS[0];

/** A determination's summary: the case, its declarant and the proposal's outcome and reasons. */
const determinationSummary = z.object({
  caseId: z.uuid(),
  caseReference: z.string(),
  declarantName: z.string(),
  personnelFileNumber: z.string().nullable(),
  outcome: z.enum(['compliant', 'compliant-no-issues', 'non-compliant', 'further-action']),
  reasonsExcerpt: z.string(),
});
export type DeterminationSummary = z.infer<typeof determinationSummary>;

/**
 * A referral's summary (services/review `ReferralApprovals`): the grounds, the declarant, the
 * narrative's start and how much evidence it rests on. `caseId` is null for two missed cycles.
 */
const referralSummary = z.object({
  grounds: z.enum([
    'undeclared-assets',
    'unexplained-assets',
    'two-missed-cycles',
    'unanswered-clarification',
  ]),
  caseId: z.uuid().nullable(),
  cycleYear: z.number().int(),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  narrativeExcerpt: z.string(),
  evidence: z.object({
    flags: z.number().int().nonnegative(),
    clarifications: z.number().int().nonnegative(),
    obligations: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
  }),
});
export type ReferralSummary = z.infer<typeof referralSummary>;

/** Each shown kind's summary, as its schema reads it. */
export interface Summaries {
  determination: DeterminationSummary;
  referral: ReferralSummary;
}

/** The summary schema of each kind the inbox shows. */
export const SUMMARIES: { [K in InboxKind]: z.ZodType<Summaries[K]> } = {
  determination: determinationSummary,
  referral: referralSummary,
};

export function isInboxKind(kind: string): kind is InboxKind {
  return Object.hasOwn(SUMMARIES, kind);
}
