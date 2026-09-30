import { describe, expect, it } from 'vitest';

import type { CommissionRef, Obligation, ObligationGroup } from '../../server/declarations/types';
import { CLOSED_REASONS, dashboardGroups, startAvailability } from './obligations';

const TSC: CommissionRef = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };
const PSC: CommissionRef = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };

function obligation(
  id: string,
  status: Obligation['status'],
  dueDate: string,
  commission = TSC,
): Obligation {
  return {
    id,
    commission,
    type: 'biennial',
    cycleKey: 'biennial:2027',
    statementDate: '2027-11-01',
    dueDate,
    status,
    cancelReason: status === 'cancelled' ? 'superseded' : null,
    remindersSent: 0,
    policyVersion: 1,
    createdAt: '2027-07-04T06:00:00Z',
  };
}

const ids = (groups: ObligationGroup[]) =>
  groups.map((group) => [group.commission.slug, group.obligations.map((entry) => entry.id)]);

// S22: grouping by Commission and ordering within a group.
describe('dashboardGroups', () => {
  it('orders overdue first, then by due date', () => {
    const groups = dashboardGroups([
      {
        commission: TSC,
        obligations: [
          obligation('upcoming', 'upcoming', '2027-12-31'),
          obligation('due-later', 'due', '2027-04-09'),
          obligation('overdue', 'overdue', '2027-10-15'),
          obligation('due-sooner', 'due', '2027-03-20'),
        ],
      },
    ]);

    expect(ids(groups)).toEqual([['tsc', ['overdue', 'due-sooner', 'due-later', 'upcoming']]]);
  });

  it('leaves out cancelled obligations and groups left empty', () => {
    const groups = dashboardGroups([
      { commission: PSC, obligations: [obligation('gone', 'cancelled', '2027-12-31', PSC)] },
      {
        commission: TSC,
        obligations: [
          obligation('kept', 'upcoming', '2027-12-31'),
          obligation('superseded', 'cancelled', '2027-04-09'),
        ],
      },
    ]);

    expect(ids(groups)).toEqual([['tsc', ['kept']]]);
  });

  it('puts the Commission with the most pressing obligation first', () => {
    const groups = dashboardGroups([
      { commission: TSC, obligations: [obligation('tsc-due', 'due', '2027-04-09')] },
      { commission: PSC, obligations: [obligation('psc-overdue', 'overdue', '2027-10-15', PSC)] },
    ]);

    expect(ids(groups)).toEqual([
      ['psc', ['psc-overdue']],
      ['tsc', ['tsc-due']],
    ]);
  });

  it('returns no groups when nothing is left to show', () => {
    expect(dashboardGroups([])).toEqual([]);
  });
});

describe('startAvailability (S20)', () => {
  it('lets the declarant start due, overdue and upcoming obligations', () => {
    for (const status of ['due', 'overdue', 'upcoming'] as const) {
      expect(startAvailability({ id: 'o-1', status }, [])).toEqual({ kind: 'start' });
    }
  });

  it('continues an existing draft for the obligation', () => {
    expect(
      startAvailability({ id: 'o-1', status: 'due' }, [
        { id: 'd-0', obligationId: 'o-2', status: 'draft' },
        { id: 'd-1', obligationId: 'o-1', status: 'draft' },
      ]),
    ).toEqual({ kind: 'continue', declarationId: 'd-1' });
  });

  it('disables filed and cancelled obligations with a reason', () => {
    expect(startAvailability({ id: 'o-1', status: 'filed' }, [])).toEqual({
      kind: 'closed',
      reason: CLOSED_REASONS.filed,
    });
    expect(startAvailability({ id: 'o-1', status: 'cancelled' }, [])).toEqual({
      kind: 'closed',
      reason: CLOSED_REASONS.cancelled,
    });
  });
});
