import { z } from 'zod';

/**
 * The kinds of approval the inbox shows (spec 08 FE-3) and how each one's summary reads.
 * review.yaml types `ApprovalItem.summary` as an open object, one shape per kind. A kind arrives
 * by adding its schema here, its tab and card in `components/approvals` (the ladder's actions,
 * #205; referrals, #211). Shared by the server functions and the inbox, so not a `.server` module.
 */

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

/** The summary schema of each kind the inbox shows. */
export const SUMMARIES = {
  determination: determinationSummary,
} as const;

/** The kinds the inbox shows so far, in tab order. */
export type InboxKind = keyof typeof SUMMARIES;

export const INBOX_KINDS = Object.keys(SUMMARIES) as InboxKind[];

export function isInboxKind(kind: string): kind is InboxKind {
  return kind in SUMMARIES;
}
