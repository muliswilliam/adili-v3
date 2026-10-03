import { SUPERVISOR } from '@adili/roles';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadApprovals, loadSupervisors, reassignApproval } from './approvals.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_DETERMINATION_IDS as D,
  MOCK_OFFICERS,
  mockReviewClient,
  resetReviewMock,
} from './review/mock.server';
import type { Assignee } from './review/types';

const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };

const supervisor = () => mockReviewClient(ME.subject, ME.name, [SUPERVISOR]);

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

describe('loadApprovals (S14)', () => {
  it('lists proposed determinations oldest first, each with canApprove for the caller', async () => {
    const result = await loadApprovals(supervisor(), 'tsc', { kind: 'determination' });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.items.map((item) => item.subjectId)).toEqual([
      D.awaitingOld,
      D.awaitingOfRecord,
      D.peters,
      D.awaitingFurther,
    ]);
    const [old, ofRecord] = result.data.items;
    expect(old).toMatchObject({
      kind: 'determination',
      canApprove: true,
      cannotApproveReason: null,
      reassignedTo: ME,
      proposer: MOCK_OFFICERS.mercy,
      summary: {
        caseId: CASES.awaitingOld,
        caseReference: 'DCB-TSC-2026-0006612-U',
        declarantName: 'Ruth Nekesa Wafula',
        outcome: 'non-compliant',
      },
    });
    expect(ofRecord).toMatchObject({
      canApprove: false,
      cannotApproveReason: 'reviewer-of-record',
    });
  });

  it('counts the pending approvals by kind and by age band', async () => {
    const result = await loadApprovals(supervisor(), 'tsc', { kind: 'determination' });
    expect(result.ok && result.data.counts).toEqual({
      byKind: { determination: 4, action: 0, referral: 0 },
      byAge: { under7Days: 1, from7To30Days: 2, over30Days: 1 },
    });
  });

  it('pages with the cursor', async () => {
    const first = await loadApprovals(supervisor(), 'tsc', { kind: 'determination', limit: 3 });
    if (!first.ok) throw new Error('first page');
    expect(first.data.items).toHaveLength(3);
    const second = await loadApprovals(supervisor(), 'tsc', {
      kind: 'determination',
      limit: 3,
      cursor: first.data.nextCursor ?? undefined,
    });
    expect(second.ok && second.data.items.map((item) => item.subjectId)).toEqual([
      D.awaitingFurther,
    ]);
    expect(second.ok && second.data.nextCursor).toBeNull();
  });

  it('is for supervisors: a reviewer gets 403', async () => {
    const result = await loadApprovals(mockReviewClient(ME.subject, ME.name), 'tsc', {
      kind: 'determination',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });
});

describe('reassignApproval (S14)', () => {
  it('points the approval at another supervisor', async () => {
    const result = await reassignApproval(
      supervisor(),
      'determination',
      D.peters,
      MOCK_OFFICERS.lucy.subject,
    );
    expect(result).toMatchObject({ ok: true, data: { reassignedTo: MOCK_OFFICERS.lucy } });
    const list = await loadApprovals(supervisor(), 'tsc', { kind: 'determination' });
    const item = list.ok ? list.data.items.find((each) => each.subjectId === D.peters) : null;
    expect(item?.reassignedTo).toEqual(MOCK_OFFICERS.lucy);
  });
});

describe('loadSupervisors', () => {
  it('names the Commission’s other supervisors, never the caller', async () => {
    const result = await loadSupervisors(supervisor(), 'tsc', ME.subject);
    expect(result).toEqual({
      ok: true,
      data: [MOCK_OFFICERS.lucy, MOCK_OFFICERS.joseph],
    });
  });
});
