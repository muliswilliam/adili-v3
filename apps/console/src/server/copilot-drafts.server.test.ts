import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pollDraft, readDraft, requestDraft } from './copilot-drafts.server';
import {
  MOCK_DRAFT_DELAY_MS,
  MOCK_DRAFT_WAIT_MS,
  MOCK_FLAG_IDS as F,
  MOCK_ITEM_IDS as I,
  setMockCopilot,
} from './review/copilot-mock.server';
import { MOCK_CASE_IDS as CASES, mockReviewClient, resetReviewMock } from './review/mock.server';
import type { CopilotDraftInput } from './review/types';

const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const client = (subject = ME) => mockReviewClient(subject, 'Faith Achieng');
const KEY = '7d9a0000-0000-4000-8000-000000000001';

const input = (picks: Partial<CopilotDraftInput> = {}): CopilotDraftInput => ({
  flagIds: [F.valueChange],
  itemRefs: [],
  language: 'en',
  ...picks,
});

const plotRef = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: I.plot,
  requirement: null,
};

/** Runs a draft request to its answer: the mock answers after `MOCK_DRAFT_WAIT_MS`. */
async function draft(body: CopilotDraftInput, key = KEY, subject = ME) {
  const answer = requestDraft(client(subject), CASES.mine, body, key);
  await vi.advanceTimersByTimeAsync(MOCK_DRAFT_WAIT_MS);
  return answer;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetReviewMock(Date.now());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Draft with AI against the review mock (S12)', () => {
  it('answers a ready draft: items in ClarificationItemInput shape, an opening and the AI label', async () => {
    const result = await draft(input({ itemRefs: [plotRef] }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'ready',
        opening: expect.any(String) as string,
        label: { task: 'draft-clarification', provider: 'anthropic', promptVersion: 2 },
        items: [
          {
            sectionKey: 'statement:officer',
            personKey: 'officer',
            itemId: I.plot,
            requirement: 'explain-discrepancy',
          },
          { itemId: I.plot, requirement: 'explain-discrepancy' },
        ],
      },
    });
  });

  it('drafts in Swahili when asked', async () => {
    const result = await draft(input({ language: 'sw' }));
    expect(result.ok && result.data.status === 'ready' && result.data.opening).toMatch(
      /^Asante kwa tamko lako/,
    );
  });

  it('answers a slow draft pending; polled, it is ready once the job is done', async () => {
    const result = await draft(
      input({ flagIds: [F.valueChange, F.acquisition, F.growth], language: 'en' }),
    );
    if (!result.ok || result.data.status !== 'pending') throw new Error('not pending');
    const { id } = result.data;

    expect(await pollDraft(client(), id)).toMatchObject({ ok: true, data: { status: 'pending' } });
    await vi.advanceTimersByTimeAsync(MOCK_DRAFT_DELAY_MS);
    const ready = await pollDraft(client(), id);
    expect(ready).toMatchObject({ ok: true, data: { status: 'ready', id } });
    expect(ready.ok && ready.data.status === 'ready' && ready.data.items).toHaveLength(3);

    // Only the reviewer who asked reads it.
    expect(await pollDraft(client('someone-else'), id)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('answers the same draft to a retry with the same key', async () => {
    const first = await draft(input());
    const again = await draft(input(), KEY);
    expect(again.ok && first.ok && again.data.id === first.data.id).toBe(true);
  });

  it('answers a failed draft with the gateway reason', async () => {
    expect(await draft(input({ flagIds: [F.foreign] }))).toMatchObject({
      ok: true,
      data: { status: 'failed', reason: 'provider-unavailable' },
    });
  });

  it('refuses a selection the case does not have, and an empty one', async () => {
    const unknown = await draft(input({ flagIds: ['f1a90000-0000-4000-8000-0000000000ff'] }));
    expect(unknown).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400, type: 'selection-not-on-case' } },
    });
    expect(await draft(input({ flagIds: [] }))).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { type: 'selection-not-on-case' } },
    });
  });

  it('is 409 ai-not-enabled when the copilot is not enabled for the Commission', async () => {
    setMockCopilot(CASES.mine, { status: 'not-enabled' });
    expect(await draft(input())).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, type: 'ai-not-enabled' } },
    });
  });

  it('is 403 for anyone but the officer holding the case', async () => {
    const result = requestDraft(client(), CASES.peters, input(), KEY);
    await vi.advanceTimersByTimeAsync(MOCK_DRAFT_WAIT_MS);
    expect(await result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });
});

describe('readDraft', () => {
  const label = {
    aiAssisted: true,
    task: 'draft-clarification',
    promptVersion: 1,
    provider: 'anthropic',
    model: 'claude',
    generatedAt: '2026-10-02T08:00:00Z',
    disclaimer: 'Indicators, not findings. A named officer decides.',
  };
  const item = {
    sectionKey: 'bio',
    personKey: null,
    itemId: null,
    requirement: 'correct',
    text: 'x',
  };
  const draft = {
    id: 'd',
    status: 'ready',
    jobId: 'j',
    label,
    opening: '  ',
    items: [item],
    failureReason: null,
  };

  it('maps the gateway label to the AiLabel details and a blank opening to none', () => {
    expect(readDraft(draft)).toEqual({
      status: 'ready',
      id: 'd',
      label: {
        task: 'draft-clarification',
        promptVersion: 1,
        provider: 'anthropic',
        model: 'claude',
        generatedAt: '2026-10-02T08:00:00Z',
        disclaimer: 'Indicators, not findings. A named officer decides.',
      },
      opening: null,
      items: [item],
    });
  });

  it('never inserts a draft without a label or items: it reads as failed validation', () => {
    expect(readDraft({ ...draft, label: null })).toEqual({
      status: 'failed',
      id: 'd',
      reason: 'validation',
    });
    expect(readDraft({ ...draft, items: [] })).toMatchObject({ reason: 'validation' });
    expect(readDraft({ ...draft, status: 'failed', failureReason: null })).toMatchObject({
      reason: 'unknown',
    });
    expect(readDraft({ nonsense: true })).toBeNull();
  });
});
