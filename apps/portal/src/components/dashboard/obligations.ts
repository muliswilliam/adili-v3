import type {
  DeclarationListItem,
  Obligation,
  ObligationGroup,
} from '../../server/declarations/types';

/** Most pressing first: overdue, due, upcoming, then filed. Cancelled obligations are not shown. */
const RANK: Record<Obligation['status'], number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  filed: 3,
  cancelled: 4,
};

function byUrgency(a: Obligation, b: Obligation): number {
  return RANK[a.status] - RANK[b.status] || a.dueDate.localeCompare(b.dueDate);
}

/**
 * The declarant's obligations as the dashboard lists them: cancelled ones left out, each
 * Commission's ordered overdue first and then by due date, and the Commission with the most
 * pressing obligation first. Commissions with nothing left to show are dropped.
 */
export function dashboardGroups(groups: readonly ObligationGroup[]): ObligationGroup[] {
  return groups
    .map((group) => ({
      commission: group.commission,
      obligations: group.obligations
        .filter((obligation) => obligation.status !== 'cancelled')
        .sort(byUrgency),
    }))
    .filter((group) => group.obligations.length > 0)
    .sort((a, b) => {
      const [first] = a.obligations;
      const [second] = b.obligations;
      return first && second ? byUrgency(first, second) : 0;
    });
}

/**
 * Whether the declarant can start (or continue) a declaration for an obligation (S20): due,
 * overdue and upcoming ones yes; filed and cancelled ones no, with the reason shown.
 */
export type StartAvailability =
  | { kind: 'start' }
  | { kind: 'continue'; declarationId: string }
  | { kind: 'closed'; reason: string };

export const CLOSED_REASONS = {
  filed: 'Already filed. There is nothing more to declare for this obligation.',
  cancelled: 'Cancelled. You do not need to declare for this obligation.',
} as const;

export function startAvailability(
  obligation: Pick<Obligation, 'id' | 'status'>,
  declarations: readonly Pick<DeclarationListItem, 'id' | 'obligationId' | 'status'>[],
): StartAvailability {
  if (obligation.status === 'filed' || obligation.status === 'cancelled') {
    return { kind: 'closed', reason: CLOSED_REASONS[obligation.status] };
  }
  const draft = declarations.find(
    (declaration) =>
      declaration.obligationId === obligation.id &&
      (declaration.status === 'draft' || declaration.status === 'amending'),
  );
  return draft ? { kind: 'continue', declarationId: draft.id } : { kind: 'start' };
}
