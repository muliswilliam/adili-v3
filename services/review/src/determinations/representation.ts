import type { ProposerKind } from '../approvals/schema.js';
import type { Assignee } from '../cases/representation.js';
import type {
  DeterminationOutcome,
  determinations,
  FurtherActionKind,
  ProposalStatus,
} from './schema.js';

type DeterminationRow = typeof determinations.$inferSelect;

/** review.yaml `Determination`. */
export interface DeterminationView {
  id: string;
  caseId: string;
  outcome: DeterminationOutcome;
  reasons: string;
  furtherActionNote: string | null;
  furtherActionLink: { kind: FurtherActionKind; id: string } | null;
  proposerKind: ProposerKind;
  proposer: Assignee | null;
  proposedAt: string;
  status: ProposalStatus;
  approver: Assignee | null;
  approvedAt: string | null;
  returnedBy: Assignee | null;
  returnedAt: string | null;
  returnReason: string | null;
  reference: string | null;
  letterAvailable: boolean;
}

/** An officer as a view names them: the name their token gave, else their subject. */
export function officer(subject: string | null, name: string | null): Assignee | null {
  return subject === null ? null : { subject, name: name ?? subject };
}

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
export const OUTCOME_LABELS: Record<DeterminationOutcome, string> = {
  compliant: 'Compliant',
  'compliant-no-issues': 'Compliant: no issues identified',
  'non-compliant': 'Non-compliant',
  'further-action': 'Further action',
};
