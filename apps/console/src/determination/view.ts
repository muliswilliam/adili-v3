import type { Assignee, CaseListItem, Determination } from '../server/review/types';
import { DETERMINATION_COPY as c } from './copy';

/**
 * What the case's Determination page shows and offers (spec 08 FE-2, S1 and S2), from the case
 * and its determinations (oldest first, the current one last). Pure. The review service decides
 * every call; this only keeps the page from offering what it would refuse.
 */

/** Who is looking. */
export interface DeterminationViewer {
  subject: string;
  supervisor: boolean;
}

/** Why nobody can propose yet, or that the viewer can. */
export type ProposeAccess =
  /** The viewer holds the case and nothing is open. */
  | 'allowed'
  /** The viewer holds the case, but a clarification is open (review answers 409). */
  | 'clarification-open'
  /** Nobody holds the case: claim it first. */
  | 'unassigned'
  /** Someone else holds the case: only they propose. */
  | { heldBy: Assignee }
  /** The case is settled. */
  | 'closed';

export type DeterminationState =
  | { kind: 'none'; propose: ProposeAccess }
  | {
      kind: 'proposed';
      current: Determination;
      /** The viewer proposed it. */
      withdraw: boolean;
      /** A supervisor other than the proposer, who decides it in the inbox (not a bulk closure). */
      openInApprovals: boolean;
    }
  | {
      kind: 'returned';
      current: Determination;
      /** The viewer holds the case. */
      revise: boolean;
      /** Who may revise it, when not the viewer. */
      heldBy: Assignee | null;
    }
  | { kind: 'approved'; current: Determination };

type CaseFacts = Pick<CaseListItem, 'status' | 'assignee'> & {
  clarification: Pick<CaseListItem['clarification'], 'open'>;
};

/** Who may propose on the case, ignoring its determinations. */
function proposeAccess(item: CaseFacts, viewer: DeterminationViewer): ProposeAccess {
  if (item.status === 'determined' || item.status === 'further-action') return 'closed';
  if (item.assignee === null) return 'unassigned';
  if (item.assignee.subject !== viewer.subject) return { heldBy: item.assignee };
  return item.clarification.open > 0 ? 'clarification-open' : 'allowed';
}

export function determinationState(
  item: CaseFacts,
  determinations: readonly Determination[],
  viewer: DeterminationViewer,
): DeterminationState {
  const current = determinations.at(-1);
  if (!current || current.status === 'withdrawn') {
    return { kind: 'none', propose: proposeAccess(item, viewer) };
  }
  if (current.status === 'approved') return { kind: 'approved', current };
  if (current.status === 'returned') {
    const access = proposeAccess(item, viewer);
    return {
      kind: 'returned',
      current,
      revise: access === 'allowed',
      heldBy: typeof access === 'object' ? access.heldBy : null,
    };
  }
  const proposedByViewer = current.proposer?.subject === viewer.subject;
  return {
    kind: 'proposed',
    current,
    withdraw: proposedByViewer,
    openInApprovals: viewer.supervisor && !proposedByViewer && !isBulkClosure(current),
  };
}

/** One line of the determination's history. */
/**
 * A bulk closure: the system's "compliant: no issues identified" proposal, approved in batches on
 * its own page (#202), never in the approvals inbox (review's `notBulkClosure`).
 */
export function isBulkClosure(
  determination: Pick<Determination, 'proposerKind' | 'outcome'>,
): boolean {
  return determination.proposerKind === 'system' && determination.outcome === 'compliant-no-issues';
}

export interface HistoryEntry {
  key: string;
  kind: 'proposed' | 'returned' | 'approved' | 'withdrawn';
  title: string;
  at: string;
}

const who = (officer: Assignee | null) => officer?.name ?? c.system;

/** Every proposal of the case and what became of it, newest first. */
export function determinationHistory(determinations: readonly Determination[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const each of determinations) {
    entries.push({
      key: `${each.id}:proposed`,
      kind: 'proposed',
      title: c.history.proposed(who(each.proposer), each.outcome),
      at: each.proposedAt,
    });
    if (each.status === 'returned' && each.returnedAt) {
      entries.push({
        key: `${each.id}:returned`,
        kind: 'returned',
        title: c.history.returned(who(each.returnedBy)),
        at: each.returnedAt,
      });
    }
    if (each.status === 'approved' && each.approvedAt) {
      entries.push({
        key: `${each.id}:approved`,
        kind: 'approved',
        title: c.history.approved(who(each.approver), each.reference),
        at: each.approvedAt,
      });
    }
    if (each.status === 'withdrawn') {
      entries.push({
        key: `${each.id}:withdrawn`,
        kind: 'withdrawn',
        title: c.history.withdrawn(who(each.proposer)),
        // The contract keeps no withdrawal time: the entry sits with its proposal.
        at: each.proposedAt,
      });
    }
  }
  // Stable: entries of one time keep their order (a withdrawal after its proposal).
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.index - a.index)
    .map(({ entry }) => entry);
}

export const REASONS_MAX_LENGTH = 4000;
export const NOTE_MAX_LENGTH = 2000;
/** review.yaml `ReasonInput`: a supervisor's reason for returning a proposal. */
export const RETURN_REASON_MAX_LENGTH = 2000;

/** The proposal dialog's fields. */
export interface ProposalForm {
  outcome: 'compliant' | 'non-compliant' | 'further-action' | null;
  reasons: string;
  /** The further action needed; only for `further-action`. */
  note: string;
}

export type ProposalErrors = Partial<Record<'outcome' | 'reasons' | 'note', string>>;

/** What is wrong with the proposal, by field; empty when it can be sent. */
export function proposalErrors(form: ProposalForm): ProposalErrors {
  const errors: ProposalErrors = {};
  if (form.outcome === null) errors.outcome = c.errors.outcome;
  if (!form.reasons.trim()) errors.reasons = c.errors.reasons;
  else if (form.reasons.length > REASONS_MAX_LENGTH) {
    errors.reasons = c.errors.reasonsTooLong(REASONS_MAX_LENGTH);
  }
  if (form.outcome === 'further-action') {
    if (!form.note.trim()) errors.note = c.errors.note;
    else if (form.note.length > NOTE_MAX_LENGTH) {
      errors.note = c.errors.noteTooLong(NOTE_MAX_LENGTH);
    }
  }
  return errors;
}
