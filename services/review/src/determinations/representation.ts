import { z } from 'zod';

import { PROPOSER_KINDS } from '../approvals/schema.js';
import { assigneeSchema, officer } from '../cases/assignee.js';
import { furtherActionLink } from './determination-input.js';
import { DETERMINATION_OUTCOMES, type determinations, PROPOSAL_STATUSES } from './schema.js';

/**
 * Bodies of the determinations API (spec 08). They are the contract: the OpenAPI document,
 * packages/schemas/internal/review.yaml, is generated from them (`pnpm contracts`).
 */

type DeterminationRow = typeof determinations.$inferSelect;

export const determinationOutcomeSchema = z.enum(DETERMINATION_OUTCOMES);
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export const proposerKindSchema = z.enum(PROPOSER_KINDS);

/** review.yaml `Determination`. */
export const determinationSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  outcome: determinationOutcomeSchema,
  reasons: z.string(),
  furtherActionNote: z.string().nullable(),
  furtherActionLink: furtherActionLink.nullable().meta({
    description: 'The action or referral a `further-action` determination links to; null when none',
  }),
  proposerKind: proposerKindSchema,
  proposer: assigneeSchema.nullable(),
  proposedAt: z.iso.datetime(),
  status: proposalStatusSchema,
  approver: assigneeSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  returnedBy: assigneeSchema
    .nullable()
    .meta({ description: 'The supervisor who returned it; null unless returned' }),
  returnedAt: z.iso.datetime().nullable(),
  returnReason: z.string().nullable(),
  reference: z
    .string()
    .nullable()
    .meta({ description: 'CMP-<ISSUER>-<YEAR>-<seq>-<check>, allocated at approval' }),
  letterAvailable: z.boolean(),
});
export type DeterminationView = z.infer<typeof determinationSchema>;

/** review.yaml `LetterDownload`. */
export const letterDownloadSchema = z.object({
  documentId: z.uuid(),
  verificationId: z.string(),
  downloadUrl: z.url().meta({
    description:
      "For staff, a link to the signed PDF valid for five minutes, handed out by the documents service for the Commission; for the declarant, the portal's download of their own letter (the documents owner rule)",
  }),
});
export type LetterDownloadView = z.infer<typeof letterDownloadSchema>;

/** review.yaml `DeterminationLetterPayload`: the fields `decision-letter.v1` renders. */
export const determinationLetterPayloadSchema = z.object({
  declarantPersonId: z.uuid().meta({
    description:
      'Who may download the letter: the documents service checks the issue request against it. Not printed',
  }),
  declarantName: z.string(),
  commission: z.object({ name: z.string(), issuerCode: z.string() }),
  declarationReference: z.string(),
  determinationReference: z.string(),
  outcome: determinationOutcomeSchema,
  outcomeLabel: z.string(),
  reasons: z.string(),
  decidedAt: z.iso.datetime(),
  portalUrl: z.url(),
});
export type DeterminationLetterPayload = z.infer<typeof determinationLetterPayloadSchema>;

/** review.yaml `DeclarantDecision`. */
export const declarantDecisionSchema = z.object({
  determinationId: z.uuid(),
  declarationReference: z.string(),
  commission: z.object({ slug: z.string(), name: z.string() }),
  outcome: determinationOutcomeSchema,
  decidedAt: z.iso.datetime(),
  reference: z.string(),
  letterAvailable: z.boolean(),
});
export type DeclarantDecisionView = z.infer<typeof declarantDecisionSchema>;

export function determinationView(row: DeterminationRow): DeterminationView {
  return {
    id: row.id,
    caseId: row.caseId,
    outcome: row.outcome,
    reasons: row.reasons,
    furtherActionNote: row.furtherActionNote,
    furtherActionLink:
      row.furtherActionKind === null || row.furtherActionId === null
        ? null
        : { kind: row.furtherActionKind, id: row.furtherActionId },
    proposerKind: row.proposerKind,
    proposer: officer(row.proposer, row.proposerName),
    proposedAt: row.proposedAt.toISOString(),
    status: row.status,
    approver: officer(row.approver, row.approverName),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    returnedBy: officer(row.returnedBy, row.returnedByName),
    returnedAt: row.returnedAt?.toISOString() ?? null,
    returnReason: row.returnReason,
    reference: row.reference,
    letterAvailable: row.letterDocumentId !== null,
  };
}

/** How letters, messages and the portal name each outcome (FE shared label table). */
export const OUTCOME_LABELS: Record<(typeof DETERMINATION_OUTCOMES)[number], string> = {
  compliant: 'Compliant',
  'compliant-no-issues': 'Compliant: no issues identified',
  'non-compliant': 'Non-compliant',
  'further-action': 'Further action',
};
