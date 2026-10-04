import { z } from 'zod';

import { LADDER_STEPS } from '../actions/ladder';
import { REFERRAL_GROUNDS } from '../referral/view';
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
export const INBOX_KINDS = [
  'determination',
  'action',
  'referral',
] as const satisfies readonly ApprovalKind[];

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

const actionStep = z.enum(LADDER_STEPS);

/**
 * A drafted ladder step's summary (review's `ActionApprovals`): the step, what the ladder is
 * about, the declarant, and the steps issued before it with the declarant's responses.
 */
const actionSummary = z.object({
  ladderId: z.uuid(),
  step: actionStep,
  subjectKind: z.enum(['obligation', 'clarification']),
  subjectId: z.uuid(),
  subjectReference: z.string(),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  priorSteps: z.array(
    z.object({
      actionId: z.uuid(),
      step: actionStep,
      status: z.string(),
      reference: z.string().nullable(),
      issuedAt: z.string().nullable(),
      respondedAt: z.string().nullable(),
      responseExcerpt: z.string().nullable(),
      responseAttachments: z.number().int().min(0),
    }),
  ),
});
export type ActionSummary = z.infer<typeof actionSummary>;

/**
 * A referral's summary (services/review `ReferralApprovals`): the grounds, the declarant, the
 * narrative's start and how much evidence it rests on. `caseId` is null for two missed cycles.
 */
const referralSummary = z.object({
  grounds: z.enum(REFERRAL_GROUNDS),
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
  action: ActionSummary;
  referral: ReferralSummary;
}

/** The summary schema of each kind the inbox shows. */
export const SUMMARIES: { [K in InboxKind]: z.ZodType<Summaries[K]> } = {
  determination: determinationSummary,
  action: actionSummary,
  referral: referralSummary,
};

export function isInboxKind(kind: string): kind is InboxKind {
  return Object.hasOwn(SUMMARIES, kind);
}
