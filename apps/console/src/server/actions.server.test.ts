import { REVIEWER, SUPERVISOR } from '@adili/roles';
import { beforeEach, describe, expect, it } from 'vitest';

import { approveStep, declineStep, loadLadder, loadLadders, restartLadder } from './actions.server';
import { decisionRefusal } from '../actions/refusal';
import { MOCK_LADDER_IDS as L, MOCK_LADDER_OFFICERS } from './review/actions-mock.server';
import { mockReviewClient, resetReviewMock } from './review/mock.server';

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';

function reviewer() {
  return mockReviewClient(ME, 'Grace Wanjiru', [REVIEWER]);
}

function supervisor() {
  return mockReviewClient(MOCK_LADDER_OFFICERS.samuel.subject, 'Samuel Njoroge', [SUPERVISOR]);
}

function key() {
  return crypto.randomUUID();
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

async function ladder(id: string) {
  const result = await loadLadder(supervisor(), id);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

describe('loadLadders', () => {
  it('lists the Commission ladders newest first, a page at a time', async () => {
    const first = await loadLadders(reviewer(), 'tsc', { limit: 5 });
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    expect(first.data.items).toHaveLength(5);
    expect(first.data.nextCursor).not.toBeNull();
    const started = first.data.items.map((each) => each.startedAt);
    expect([...started].sort().reverse()).toEqual(started);

    const second = await loadLadders(reviewer(), 'tsc', {
      limit: 5,
      cursor: first.data.nextCursor ?? undefined,
    });
    if (!second.ok) throw new Error('not ok');
    const ids = new Set(first.data.items.map((each) => each.id));
    expect(second.data.items.some((each) => ids.has(each.id))).toBe(false);
  });

  it('filters by the current step status', async () => {
    const result = await loadLadders(reviewer(), 'tsc', { status: 'proposed', limit: 50 });
    if (!result.ok) throw new Error('not ok');
    expect(result.data.items.length).toBeGreaterThan(0);
    for (const item of result.data.items) {
      const current = item.steps.findLast((step) => step.step === item.currentStep);
      expect(current?.status).toBe('proposed');
    }
  });

  it('is a 404 for another Commission', async () => {
    const result = await loadLadders(reviewer(), 'psc', { limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: 'problem', problem: { status: 404 } });
  });
});

describe('approveStep (S5)', () => {
  it('a reviewer approves the system notice: ADM reference, issued, window of 14 days', async () => {
    const before = await ladder(L.noticeProposed);
    const notice = before.steps[0];
    if (!notice) throw new Error('no notice');
    expect(notice.proposerKind).toBe('system');

    const result = await approveStep(reviewer(), notice.id, key());
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.approver?.name).toBe('Grace Wanjiru');
    expect(result.data.reference).toMatch(/^ADM-TSC-2026-\d{7}-[0-9A-Z]$/);

    const after = await ladder(L.noticeProposed);
    const issued = after.steps[0];
    expect(issued?.status).toBe('issued');
    expect(issued?.letter).not.toBeNull();
    const issuedAt = Date.parse(issued?.issuedAt ?? '');
    expect(issuedAt - NOW_MS).toBeLessThan(5_000);
    expect(Date.parse(issued?.windowEndsAt ?? '') - issuedAt).toBe(14 * 86_400_000);
  });

  it('replays the first answer for the same Idempotency-Key', async () => {
    const notice = (await ladder(L.noticeProposed)).steps[0];
    if (!notice) throw new Error('no notice');
    const same = key();
    const first = await approveStep(reviewer(), notice.id, same);
    const again = await approveStep(reviewer(), notice.id, same);
    if (!first.ok || !again.ok) throw new Error('not ok');
    expect(again.data.reference).toBe(first.data.reference);
  });

  it('refuses a reviewer of record with separation-of-duties', async () => {
    const warning = (await ladder(L.warningBlocked)).steps.find((s) => s.step === 'warning');
    if (!warning) throw new Error('no warning');
    const result = await approveStep(reviewer(), warning.id, key());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(decisionRefusal(result.error)).toBe('reviewer-of-record');
  });

  it('refuses a reviewer the salary stoppage: supervisors only', async () => {
    const stoppage = (await ladder(L.stoppageProposed)).steps.find(
      (s) => s.step === 'salary-stoppage',
    );
    if (!stoppage) throw new Error('no stoppage');
    const result = await approveStep(reviewer(), stoppage.id, key());
    if (result.ok) throw new Error('approved');
    expect(decisionRefusal(result.error)).toBe('role');
  });

  it('is a 409 not-proposed for a step already decided', async () => {
    const issued = (await ladder(L.noticeResponded)).steps[0];
    if (!issued) throw new Error('no notice');
    const result = await approveStep(supervisor(), issued.id, key());
    if (result.ok) throw new Error('approved');
    expect(decisionRefusal(result.error)).toBe('not-proposed');
  });
});

describe('declineStep and restartLadder (S8)', () => {
  it('a decline with a note ends the ladder; a supervisor restarts it', async () => {
    const notice = (await ladder(L.noticeProposed)).steps[0];
    if (!notice) throw new Error('no notice');
    const declined = await declineStep(reviewer(), notice.id, 'On approved study leave.', key());
    if (!declined.ok) throw new Error(JSON.stringify(declined.error));
    expect(declined.data).toMatchObject({
      status: 'declined',
      declineNote: 'On approved study leave.',
      declinedBy: { name: 'Grace Wanjiru' },
    });
    const ended = await ladder(L.noticeProposed);
    expect(ended.status).toBe('declined');

    const byReviewer = await restartLadder(reviewer(), L.noticeProposed, key());
    if (byReviewer.ok) throw new Error('restarted');
    expect(decisionRefusal(byReviewer.error)).toBe('role');

    const restarted = await restartLadder(supervisor(), L.noticeProposed, key());
    if (!restarted.ok) throw new Error(JSON.stringify(restarted.error));
    expect(restarted.data.status).toBe('active');
    expect(restarted.data.steps.map((s) => [s.step, s.status])).toEqual([
      ['notice-to-comply', 'declined'],
      ['notice-to-comply', 'proposed'],
    ]);
  });

  it('is a 409 ladder-not-declined for an active ladder', async () => {
    const result = await restartLadder(supervisor(), L.noticeResponded, key());
    if (result.ok) throw new Error('restarted');
    expect(result.error).toMatchObject({ kind: 'problem', problem: { status: 409 } });
  });
});

describe('loadLadder', () => {
  it('shows the declarant response on the issued notice (S9)', async () => {
    const found = await ladder(L.noticeResponded);
    expect(found.subjectKind).toBe('clarification');
    expect(found.steps[0]?.status).toBe('responded');
    expect(found.steps[0]?.response?.attachments).toHaveLength(2);
  });

  it('is a 404 for an unknown ladder', async () => {
    const result = await loadLadder(reviewer(), '00000000-0000-4000-8000-000000000000');
    if (result.ok) throw new Error('found');
    expect(result.error).toMatchObject({ kind: 'problem', problem: { status: 404 } });
  });
});
