import type { Obligation, ObligationGroup } from '../../server/declarations/types';

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
