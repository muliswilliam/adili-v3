import { beforeEach, describe, expect, it } from 'vitest';

import {
  issueDraft,
  loadClarificationDetail,
  raiseFollowUp,
  resolve,
  saveDraft,
  withdraw,
} from './clarifications.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_CLARIFICATION_IDS as K,
  mockReviewClient,
  resetReviewMock,
} from './review/mock.server';
import { MOCK_ITEM_IDS } from './review/copilot-mock.server';

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';

function client() {
  return mockReviewClient(ME, 'Grace Wanjiru');
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

describe('loadClarificationDetail', () => {
  it('returns the clarification with its response, the case and what else is open', async () => {
    const result = await loadClarificationDetail(client(), CASES.mine, K.late, ME, NOW);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { clarification, mine, windowOpen, othersOpen } = result.data;
    expect(clarification.status).toBe('responded');
    expect(clarification.response?.items[0]?.attachments).toHaveLength(2);
    expect(result.data.case.reference).toBe('DCI-TSC-2026-0003418-P');
    expect(mine).toBe(true);
    expect(windowOpen).toBe(true);
    // issued, onTime and overdue are still outstanding besides this one.
    expect(othersOpen).toBe(3);
  });

  it('is not mine on a case someone else holds', async () => {
    const result = await loadClarificationDetail(client(), CASES.peters, K.petersOverdue, ME, NOW);
    if (!result.ok) throw new Error('not ok');
    expect(result.data.mine).toBe(false);
    expect(result.data.case.assignee?.name).toBe('Peter Mwangi');
  });

  it('knows when the six-month window has closed', async () => {
    const result = await loadClarificationDetail(
      client(),
      CASES.windowClosed,
      K.closedWindow,
      ME,
      NOW,
    );
    if (!result.ok) throw new Error('not ok');
    expect(result.data.windowOpen).toBe(false);
  });

  it('is a 404 when the clarification is not on that case', async () => {
    const result = await loadClarificationDetail(client(), CASES.peters, K.late, ME, NOW);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });
});

describe('actions (S15)', () => {
  it('resolves with a note; the last one open makes the case ready for determination', async () => {
    const resolved = await resolve(client(), K.late, 'Explained with a loan statement.');
    if (!resolved.ok) throw new Error('not ok');
    expect(resolved.data).toMatchObject({
      status: 'resolved',
      resolutionNote: 'Explained with a loan statement.',
    });

    for (const id of [K.issued, K.onTime]) await resolve(client(), id, 'Done.');
    await withdraw(client(), K.overdue, 'Issued in error.');
    const detail = await loadClarificationDetail(client(), CASES.mine, K.late, ME, NOW);
    if (!detail.ok) throw new Error('not ok');
    expect(detail.data.case.status).toBe('ready-for-determination');
    const steps = await mockReviewClient(ME, 'Grace Wanjiru').GET('/v1/review/cases/{caseId}', {
      params: { path: { caseId: CASES.mine } },
    });
    expect(steps.data?.timeline.map((entry) => entry.ref)).toEqual([
      'clarified',
      'ready-for-determination',
    ]);
    expect(detail.data.othersOpen).toBe(0);
  });

  it('raises a follow-up as a draft with the same items and followUpOf', async () => {
    const draft = await raiseFollowUp(client(), K.onTime);
    if (!draft.ok) throw new Error('not ok');
    expect(draft.data).toMatchObject({ status: 'draft', reference: null, followUpOf: K.onTime });
    expect(draft.data.items).toHaveLength(2);

    const back = await loadClarificationDetail(client(), CASES.mine, K.onTime, ME, NOW);
    if (!back.ok) throw new Error('not ok');
    expect(back.data.followUps).toEqual([{ id: draft.data.id, reference: null, status: 'draft' }]);
  });

  it('withdraws with a reason and revokes the letter', async () => {
    const withdrawn = await withdraw(client(), K.issued, 'Issued against the wrong item');
    if (!withdrawn.ok) throw new Error('not ok');
    expect(withdrawn.data.status).toBe('withdrawn');
    expect(withdrawn.data.letter?.status).toBe('revoked');
  });

  it('refuses anyone but the reviewer holding the case (403), and a wrong status (409)', async () => {
    expect(await resolve(client(), K.petersOverdue, 'Mine now')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
    expect(await withdraw(client(), K.late, 'Too late to withdraw')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409 } },
    });
    // review.yaml: resolve answers 409 unless issued or responded.
    expect(await resolve(client(), K.overdue, 'Overdue')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409 } },
    });
  });
});

const PLOT_ITEM = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: MOCK_ITEM_IDS.plot,
  requirement: 'explain-discrepancy' as const,
  text: 'Explain the 150% change in value.',
};
const KEYS = {
  draft: 'd0000000-0000-4000-8000-000000000001',
  issue: 'd0000000-0000-4000-8000-000000000002',
};

describe('saveDraft', () => {
  it('creates a draft on the case, then updates the same one', async () => {
    const created = await saveDraft(client(), CASES.mine, null, [PLOT_ITEM], KEYS.draft);
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    expect(created.data).toMatchObject({
      caseId: CASES.mine,
      status: 'draft',
      reference: null,
      items: [PLOT_ITEM],
    });

    const updated = await saveDraft(client(), CASES.mine, created.data.id, [], KEYS.draft);
    if (!updated.ok) throw new Error('not ok');
    expect(updated.data).toMatchObject({ id: created.data.id, items: [] });
  });

  it('replays a create with the same key instead of making a second draft', async () => {
    const first = await saveDraft(client(), CASES.mine, null, [PLOT_ITEM], KEYS.draft);
    const again = await saveDraft(client(), CASES.mine, null, [PLOT_ITEM], KEYS.draft);
    if (!first.ok || !again.ok) throw new Error('not ok');
    expect(again.data.id).toBe(first.data.id);
  });

  it('refuses a case someone else holds (403)', async () => {
    expect(await saveDraft(client(), CASES.peters, null, [PLOT_ITEM], KEYS.draft)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('refuses to change a clarification already issued (409)', async () => {
    expect(await saveDraft(client(), CASES.mine, K.issued, [PLOT_ITEM], KEYS.draft)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409 } },
    });
  });
});

describe('issueDraft (S12)', () => {
  it('saves the items and issues: CLR reference, due in 30 days, letter on its way', async () => {
    const issued = await issueDraft(client(), CASES.mine, null, [PLOT_ITEM], KEYS);
    if (!issued.ok) throw new Error(JSON.stringify(issued.error));
    expect(issued.data.status).toBe('issued');
    expect(issued.data.reference).toMatch(/^CLR-TSC-2026-\d{7}-[0-9A-Z]$/);
    expect(issued.data.items).toEqual([PLOT_ITEM]);
    expect(issued.data.letter?.status).toBe('pending');
    const { issuedAt, dueAt } = issued.data;
    expect(Date.parse(dueAt ?? '') - Date.parse(issuedAt ?? '')).toBe(30 * 86_400_000);
  });

  it('issues a saved draft with its latest items', async () => {
    const draft = await saveDraft(client(), CASES.mine, null, [], KEYS.draft);
    if (!draft.ok) throw new Error('not ok');
    const issued = await issueDraft(client(), CASES.mine, draft.data.id, [PLOT_ITEM], KEYS);
    if (!issued.ok) throw new Error('not ok');
    expect(issued.data).toMatchObject({ id: draft.data.id, status: 'issued', items: [PLOT_ITEM] });
  });

  it('keeps the draft when the six-month window has closed (409), with the date', async () => {
    const result = await issueDraft(client(), CASES.windowClosed, null, [PLOT_ITEM], KEYS);
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'problem',
        problem: { status: 409, type: 'clarification-window-closed' },
      },
    });
    if (result.ok) throw new Error('issued');
    expect(result.draftId).toEqual(expect.any(String));
    const kept = await client().GET('/v1/review/clarifications/{clarificationId}', {
      params: { path: { clarificationId: result.draftId ?? '' } },
    });
    expect(kept.data).toMatchObject({ status: 'draft', items: [PLOT_ITEM] });
  });

  it('refuses a draft without items (400)', async () => {
    expect(await issueDraft(client(), CASES.mine, null, [], KEYS)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400 } },
    });
  });

  it('replays an issue with the same key', async () => {
    const first = await issueDraft(client(), CASES.mine, null, [PLOT_ITEM], KEYS);
    if (!first.ok) throw new Error('not ok');
    const again = await issueDraft(client(), CASES.mine, first.data.id, [PLOT_ITEM], KEYS);
    expect(again).toMatchObject({
      ok: true,
      data: { id: first.data.id, reference: first.data.reference },
    });
  });
});
