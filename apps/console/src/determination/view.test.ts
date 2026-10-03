import { describe, expect, it } from 'vitest';

import type { Determination } from '../server/review/types';
import { determinationHistory, determinationState, proposalErrors } from './view';

const FAITH = { subject: 'faith', name: 'Faith Achieng' };
const LUCY = { subject: 'lucy', name: 'Lucy Wambui' };
const SAMUEL = { subject: 'samuel', name: 'Samuel Njoroge' };

function determination(overrides: Partial<Determination> = {}): Determination {
  return {
    id: 'd1',
    caseId: 'c1',
    outcome: 'compliant',
    reasons: 'All flags reviewed.',
    furtherActionNote: null,
    furtherActionLink: null,
    proposerKind: 'user',
    proposer: FAITH,
    proposedAt: '2026-09-26T06:00:00Z',
    status: 'proposed',
    approver: null,
    approvedAt: null,
    returnedBy: null,
    returnedAt: null,
    returnReason: null,
    reference: null,
    letterAvailable: false,
    ...overrides,
  };
}

const openCase = {
  status: 'ready-for-determination',
  assignee: FAITH,
  clarification: { open: 0 },
} as const;

describe('determinationState', () => {
  it('lets the assignee propose when nothing is proposed', () => {
    expect(determinationState(openCase, [], { subject: 'faith', supervisor: false })).toEqual({
      kind: 'none',
      propose: 'allowed',
    });
  });

  it('asks the assignee to settle open clarifications first', () => {
    const state = determinationState(
      { ...openCase, status: 'awaiting-clarification', clarification: { open: 1 } },
      [],
      { subject: 'faith', supervisor: false },
    );
    expect(state).toEqual({ kind: 'none', propose: 'clarification-open' });
  });

  it('tells anyone else who may propose', () => {
    expect(determinationState(openCase, [], { subject: 'samuel', supervisor: true })).toEqual({
      kind: 'none',
      propose: { heldBy: FAITH },
    });
    expect(
      determinationState({ ...openCase, assignee: null }, [], {
        subject: 'samuel',
        supervisor: true,
      }),
    ).toEqual({ kind: 'none', propose: 'unassigned' });
  });

  it('shows a proposal awaiting approval; its proposer may withdraw it', () => {
    const current = determination();
    expect(
      determinationState(openCase, [current], { subject: 'faith', supervisor: false }),
    ).toEqual({ kind: 'proposed', current, withdraw: true, openInApprovals: false });
    expect(
      determinationState(openCase, [current], { subject: 'samuel', supervisor: true }),
    ).toEqual({ kind: 'proposed', current, withdraw: false, openInApprovals: true });
  });

  it('lets the assignee revise a returned proposal', () => {
    const current = determination({
      status: 'returned',
      returnedBy: SAMUEL,
      returnedAt: '2026-09-27T06:00:00Z',
      returnReason: 'Say how the land value was explained.',
    });
    expect(
      determinationState(openCase, [current], { subject: 'faith', supervisor: false }),
    ).toEqual({ kind: 'returned', current, revise: true });
    expect(
      determinationState(openCase, [current], { subject: 'samuel', supervisor: true }),
    ).toEqual({ kind: 'returned', current, revise: false });
  });

  it('shows the approved determination, whoever looks', () => {
    const current = determination({ status: 'approved', approver: LUCY, reference: 'CMP-1' });
    expect(
      determinationState({ ...openCase, status: 'determined' }, [current], {
        subject: 'samuel',
        supervisor: true,
      }),
    ).toEqual({ kind: 'approved', current });
  });

  it('treats a withdrawn proposal as none: the assignee proposes again', () => {
    const withdrawn = determination({ status: 'withdrawn' });
    expect(
      determinationState(openCase, [withdrawn], { subject: 'faith', supervisor: false }),
    ).toEqual({ kind: 'none', propose: 'allowed' });
  });
});

describe('determinationHistory', () => {
  it('lists every proposal and decision, newest first', () => {
    const history = determinationHistory([
      determination({
        id: 'a',
        status: 'returned',
        returnedBy: SAMUEL,
        returnedAt: '2026-09-27T06:00:00Z',
      }),
      determination({
        id: 'b',
        outcome: 'non-compliant',
        proposedAt: '2026-09-28T06:00:00Z',
        status: 'approved',
        approver: LUCY,
        approvedAt: '2026-09-29T06:00:00Z',
        reference: 'CMP-TSC-2026-0003104-M',
      }),
    ]);
    expect(history.map((entry) => entry.title)).toEqual([
      'Approved by Lucy Wambui · CMP-TSC-2026-0003104-M',
      'Proposed by Faith Achieng: Non-compliant',
      'Returned by Samuel Njoroge',
      'Proposed by Faith Achieng: Compliant',
    ]);
  });
});

describe('proposalErrors', () => {
  it('asks for an outcome and reasons, and a note for further action', () => {
    expect(proposalErrors({ outcome: null, reasons: ' ', note: '' })).toEqual({
      outcome: 'Choose a determination.',
      reasons: 'Enter your reasons.',
    });
    expect(proposalErrors({ outcome: 'further-action', reasons: 'Seen.', note: '' })).toEqual({
      note: 'Say what further action is needed.',
    });
    expect(proposalErrors({ outcome: 'compliant', reasons: 'x'.repeat(4001), note: '' })).toEqual({
      reasons: 'Reasons can be up to 4,000 characters.',
    });
    expect(proposalErrors({ outcome: 'compliant', reasons: 'Seen.', note: '' })).toEqual({});
  });
});
