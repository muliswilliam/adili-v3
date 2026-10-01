import type { Obligation, ObligationGroup } from '../../server/declarations/types';
import type { MyObligationsResult } from '../../server/obligations.server';
import type { DraftsState } from './drafts';
import { messages as m } from './obligation-messages';

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
 * overdue and upcoming ones yes; filed and cancelled ones no, with the reason shown. While the
 * declarations are still loading it is `pending`: a draft may exist to continue. When they could
 * not be loaded the declarant may still start: the service answers with the existing draft.
 */
export type StartAvailability =
  | { kind: 'start' }
  | { kind: 'pending' }
  | { kind: 'continue'; declarationId: string }
  | { kind: 'closed'; reason: string };

export function startAvailability(
  obligation: Pick<Obligation, 'id' | 'status'>,
  drafts: DraftsState,
): StartAvailability {
  if (obligation.status === 'filed') return { kind: 'closed', reason: m.closedFiled };
  if (obligation.status === 'cancelled') return { kind: 'closed', reason: m.closedCancelled };
  if (drafts.status === 'pending') return { kind: 'pending' };
  if (drafts.status === 'unavailable') return { kind: 'start' };
  const draft = drafts.declarations.find(
    (declaration) =>
      declaration.obligationId === obligation.id &&
      (declaration.status === 'draft' || declaration.status === 'amending'),
  );
  return draft ? { kind: 'continue', declarationId: draft.id } : { kind: 'start' };
}

/**
 * `getMyObligations`' answer, with a call that fails outright (the network, the server function)
 * read as unavailable: the obligations section then offers a retry, where the rejection would
 * reach `use()` and replace the whole dashboard with the route's error boundary.
 */
export function orUnavailable(load: Promise<MyObligationsResult>): Promise<MyObligationsResult> {
  return load.catch(() => ({ status: 'unavailable' }) as const);
}
