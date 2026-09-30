import { describe, expect, it } from 'vitest';

import type {
  CommissionRef,
  DeclarationListItem,
  Obligation,
  ObligationGroup,
} from '../../server/declarations/types';
import { messages } from './obligation-messages';
import { dashboardGroups, startAvailability } from './obligations';

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
  const none = { status: 'ok', declarations: [] } as const;
  const draft = (id: string, obligationId: string): DeclarationListItem => ({
    id,
    obligationId,
    commission: TSC,
    type: 'biennial',
    statementDate: '2027-11-01',
    status: 'draft',
    completenessPercent: 10,
    dueDate: '2027-12-31',
    reference: null,
    currentVersion: null,
    amendingFromVersion: null,
    submittedAt: null,
    late: null,
    amendable: false,
    acknowledgement: null,
    updatedAt: '2026-12-20T08:00:00Z',
  });

  it('lets the declarant start due, overdue and upcoming obligations', () => {
    for (const status of ['due', 'overdue', 'upcoming'] as const) {
      expect(startAvailability({ id: 'o-1', status }, none)).toEqual({ kind: 'start' });
    }
  });

  it('continues an existing draft for the obligation', () => {
    expect(
      startAvailability(
        { id: 'o-1', status: 'due' },
        {
          status: 'ok',
          declarations: [draft('d-0', 'o-2'), draft('d-1', 'o-1')],
        },
      ),
    ).toEqual({ kind: 'continue', declarationId: 'd-1' });
  });

  it('waits while the declarations load, and starts when they could not be', () => {
    expect(startAvailability({ id: 'o-1', status: 'due' }, { status: 'pending' })).toEqual({
      kind: 'pending',
    });
    expect(startAvailability({ id: 'o-1', status: 'due' }, { status: 'unavailable' })).toEqual({
      kind: 'start',
    });
  });

  it('offers the acknowledgement of the declaration that filed the obligation', () => {
    const filed = { ...draft('d-1', 'o-1'), status: 'amending' as const, currentVersion: 1 };

    expect(
      startAvailability(
        { id: 'o-1', status: 'filed' },
        { status: 'ok', declarations: [draft('d-0', 'o-2'), filed] },
      ),
    ).toEqual({ kind: 'filed', declaration: filed });
  });

  it('disables filed obligations without their declaration, and cancelled ones, with a reason', () => {
    for (const drafts of [
      { status: 'pending' } as const,
      { status: 'unavailable' } as const,
      none,
    ]) {
      expect(startAvailability({ id: 'o-1', status: 'filed' }, drafts)).toEqual({
        kind: 'closed',
        reason: messages.closedFiled,
      });
    }
    expect(startAvailability({ id: 'o-1', status: 'cancelled' }, none)).toEqual({
      kind: 'closed',
      reason: messages.closedCancelled,
    });
  });
});
