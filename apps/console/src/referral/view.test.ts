import { describe, expect, it } from 'vitest';

import { mockFlags } from '../server/review/copilot-mock.server';
import type { Clarification, Referral } from '../server/review/types';
import {
  approvalPanel,
  evidenceLabel,
  obligationLabel,
  referableClarifications,
  referableFlags,
  referralErrors,
  referralPhase,
  referralTitle,
} from './view';

const ME = { subject: 'me', name: 'Faith Achieng' };

function referral(overrides: Partial<Referral> = {}): Referral {
  return {
    id: 'r1',
    caseId: 'c1',
    cycleYear: 2026,
    grounds: 'undeclared-assets',
    proposerKind: 'user',
    proposer: { subject: 'peter', name: 'Peter Mwangi' },
    proposedAt: '2026-09-22T08:00:00Z',
    status: 'proposed',
    approver: null,
    approvedAt: null,
    declinedBy: null,
    declinedAt: null,
    declineNote: null,
    reference: null,
    sources: { caseIds: [], flagIds: [], clarificationIds: [], obligationIds: [], actionIds: [] },
    narrative: 'A parcel is left out.',
    package: null,
    sentAt: null,
    icmsCaseNumber: null,
    icmsRegisteredAt: null,
    declarantName: 'Ruth Nekesa Wafula',
    personnelFileNumber: '20116612',
    ...overrides,
  };
}

describe('referableFlags', () => {
  it('keeps the registry and comparison flags that still count', () => {
    const flags = mockFlags('v1');
    const closed = flags.map((flag) => ({
      ...flag,
      id: `${flag.id}-closed`,
      closedReason: 'superseded-by-recheck' as const,
    }));
    const kept = referableFlags([...flags, ...closed]).map((flag) => flag.ruleId);
    expect(kept).toEqual(['value-change-25', 'acquisition-unflagged', 'income-vs-asset-growth']);
  });
});

describe('referableClarifications', () => {
  it('keeps the issued ones (sent, answered, overdue or resolved), not drafts or withdrawn', () => {
    const of = (id: string, status: Clarification['status'], reference: string | null) =>
      ({ id, status, reference }) as Clarification;
    const kept = referableClarifications([
      of('a', 'issued', 'CLR-1'),
      of('b', 'draft', null),
      of('c', 'responded', 'CLR-2'),
      of('d', 'withdrawn', 'CLR-3'),
      of('e', 'overdue', 'CLR-4'),
      of('f', 'resolved', 'CLR-5'),
    ]).map((each) => each.id);
    expect(kept).toEqual(['a', 'c', 'e', 'f']);
  });
});

describe('referralErrors', () => {
  it('asks for the grounds, a flag and the narrative', () => {
    expect(
      referralErrors({ grounds: null, flagIds: [], clarificationIds: [], narrative: ' ' }),
    ).toEqual({
      grounds: 'Choose the grounds.',
      evidence: 'Select at least one flag that supports the referral.',
      narrative: 'Enter the narrative.',
    });
  });

  it('caps the narrative at 8,000 characters', () => {
    expect(
      referralErrors({
        grounds: 'unexplained-assets',
        flagIds: ['f'],
        clarificationIds: [],
        narrative: 'x'.repeat(8001),
      }),
    ).toEqual({ narrative: 'The narrative can be up to 8,000 characters.' });
  });
});

describe('referralPhase and referralTitle', () => {
  it('reads an approved referral without a package as assembling', () => {
    const approved = referral({ status: 'approved', reference: 'RFL-PSC-2026-0000032-9' });
    expect(referralPhase(approved)).toBe('assembling');
    expect(referralTitle(approved)).toBe('RFL-PSC-2026-0000032-9');
  });

  it('names a referral without a reference by where it stands', () => {
    expect(referralTitle(referral())).toBe('Proposed referral');
    expect(referralTitle(referral({ status: 'declined' }))).toBe('Declined referral');
  });
});

describe('approvalPanel', () => {
  it('lets a supervisor decide a proposal someone else made', () => {
    expect(approvalPanel(referral(), ME, true)).toBe('decide');
  });

  it('tells the proposer and reviewers why they cannot', () => {
    expect(approvalPanel(referral({ proposer: ME }), ME, true)).toBe('proposer');
    expect(approvalPanel(referral(), ME, false)).toBe('role');
  });

  it('shows the decision once it is made', () => {
    expect(approvalPanel(referral({ status: 'sent' }), ME, true)).toBe('decided');
  });
});

describe('obligationLabel', () => {
  it('names an obligation by its type and cycle', () => {
    expect(obligationLabel('biennial:2024')).toBe('Biennial declaration 2024');
    expect(obligationLabel('initial:2025-03-01')).toBe('Initial declaration 2025-03-01');
    expect(obligationLabel('0199-uuid')).toBe('0199-uuid');
  });
});

describe('evidenceLabel', () => {
  it('names a flag by what its rule found, and keeps the case it is on', () => {
    expect(evidenceLabel('flag', 'DCB-TSC-2026-0002210-X registry-parcel-undeclared')).toEqual({
      text: 'Land parcel not declared',
      detail: 'DCB-TSC-2026-0002210-X',
    });
  });

  it('names an obligation by its type and cycle, and keeps other references as they are', () => {
    expect(evidenceLabel('obligation', 'biennial:2024')).toEqual({
      text: 'Biennial declaration 2024',
      detail: null,
    });
    expect(evidenceLabel('letter', 'ADM-TSC-2026-0000301-8')).toEqual({
      text: 'ADM-TSC-2026-0000301-8',
      detail: null,
    });
    expect(evidenceLabel('flag', 'DCB-TSC-2026-0002210-X some-new-rule')).toEqual({
      text: 'DCB-TSC-2026-0002210-X some-new-rule',
      detail: null,
    });
  });
});
