import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCopilot, rateOutput, readCopilotView, refreshCopilot } from './copilot.server';
import {
  MOCK_COPILOT_DELAY_MS,
  MOCK_FLAG_IDS,
  mockSummary,
  setMockAiOff,
  setMockCopilot,
} from './review/copilot-mock.server';
import { MOCK_CASE_IDS as CASES, mockReviewClient, resetReviewMock } from './review/mock.server';
import type { CopilotView } from './review/types';

const NOW_MS = Date.parse('2026-10-01T09:00:00Z');
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const client = () => mockReviewClient(ME, 'Grace Wanjiru');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS);
  resetReviewMock(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

const view = (over: Partial<CopilotView>): CopilotView => ({
  status: 'ready',
  forVersionId: null,
  generatedAt: null,
  failureReason: null,
  summary: null,
  explanations: null,
  jobs: { summarize: null, explain: null },
  feedback: [],
  ...over,
});

describe('readCopilotView', () => {
  it('reads the summary and explanations the contract types loosely', () => {
    const summary = mockSummary('2026-10-01T06:00:00Z');
    const copilot = readCopilotView(view({ summary }));
    expect(copilot.status).toBe('ready');
    expect(copilot.summary?.worthAttention[0]?.flagIds).toContain(MOCK_FLAG_IDS.valueChange);
  });

  it('reads a ready view without a usable summary as failed validation', () => {
    expect(readCopilotView(view({ summary: { overview: 42 } }))).toMatchObject({
      status: 'failed',
      failureReason: 'validation',
      summary: null,
    });
  });

  it('reads a stale view with nothing produced yet as pending', () => {
    expect(readCopilotView(view({ status: 'stale' })).status).toBe('pending');
  });
});

describe('copilot endpoints (review mock)', () => {
  it('reads a ready copilot with typed outputs', async () => {
    const result = await loadCopilot(client(), CASES.mine);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.status).toBe('ready');
    expect(result.data.summary?.label.task).toBe('summarize-declaration');
    expect(result.data.explanations?.explanations).toHaveLength(4);
    expect(result.data.jobs.summarize).toBeTruthy();
  });

  it('refreshes for the holder: pending, then ready after the jobs finish', async () => {
    const refreshed = await refreshCopilot(client(), CASES.mine);
    if (!refreshed.ok) throw new Error(JSON.stringify(refreshed.error));
    expect(refreshed.data.status).toBe('pending');

    const again = await refreshCopilot(client(), CASES.mine);
    expect(again.ok || again.error).toMatchObject({ kind: 'problem', problem: { status: 409 } });

    vi.setSystemTime(NOW_MS + MOCK_COPILOT_DELAY_MS);
    const later = await loadCopilot(client(), CASES.mine);
    expect(later.ok && later.data.status).toBe('ready');
  });

  it('generates as of when the mock was seeded, not the wall clock', async () => {
    // Seeded as of NOW, but run a month later.
    const later = NOW_MS + 30 * 86_400_000;
    vi.setSystemTime(later);
    resetReviewMock(NOW_MS);
    await refreshCopilot(client(), CASES.mine);
    vi.setSystemTime(later + MOCK_COPILOT_DELAY_MS);
    const ready = await loadCopilot(client(), CASES.mine);
    if (!ready.ok) throw new Error(JSON.stringify(ready.error));
    expect(ready.data.generatedAt).toBe(new Date(NOW_MS + MOCK_COPILOT_DELAY_MS).toISOString());
  });

  it('refuses a refresh by someone not holding the case', async () => {
    const theirs = await refreshCopilot(client(), CASES.peters);
    expect(theirs.ok || theirs.error).toMatchObject({ problem: { status: 403 } });
  });

  it('asks again when the copilot was not enabled: pending once the Commission may use AI', async () => {
    setMockCopilot(CASES.mine, { status: 'not-enabled', summary: null, explanations: null });
    const asked = await refreshCopilot(client(), CASES.mine);
    expect(asked.ok && asked.data.status).toBe('pending');
  });

  it('asks again when the copilot was not enabled, and stays so while AI is still off', async () => {
    setMockAiOff(true);
    setMockCopilot(CASES.mine, { status: 'not-enabled', summary: null, explanations: null });
    const asked = await refreshCopilot(client(), CASES.mine);
    expect(asked.ok && asked.data.status).toBe('not-enabled');
  });

  it('keeps one rating per output block, by the reviewer holding the case, and lists it to every reader', async () => {
    const loaded = await loadCopilot(client(), CASES.mine);
    if (!loaded.ok) throw new Error('not ok');
    const jobId = loaded.data.jobs.summarize ?? '';
    const rated = (block: string | null) => ({ block, reason: null, note: null });
    expect(
      (await rateOutput(client(), jobId, { ...rated('overview'), rating: 'helpful' })).ok,
    ).toBe(true);
    await rateOutput(client(), jobId, {
      block: 'overview',
      rating: 'not-helpful',
      reason: 'unclear',
      note: 'Long',
    });
    await rateOutput(client(), jobId, { ...rated('changes'), rating: 'helpful' });

    const mine = await loadCopilot(client(), CASES.mine);
    expect(mine.ok && mine.data.feedback).toEqual([
      { jobId, block: 'overview', rating: 'not-helpful' },
      { jobId, block: 'changes', rating: 'helpful' },
    ]);
    // The view lists the assignee's ratings to anyone reading it (read-only for them).
    const other = await loadCopilot(mockReviewClient('someone-else', 'Peter'), CASES.mine);
    expect(other.ok && other.data.feedback).toEqual(mine.ok && mine.data.feedback);
    // A block the output does not have is refused.
    const flagOnSummary = await rateOutput(client(), jobId, {
      ...rated(`flag:${loaded.data.explanations?.explanations[0]?.flagId ?? ''}`),
      rating: 'helpful',
    });
    expect(flagOnSummary.ok || flagOnSummary.error).toMatchObject({ problem: { status: 400 } });
    const explained = loaded.data.explanations?.explanations[0]?.flagId ?? '';
    expect(
      (
        await rateOutput(client(), loaded.data.jobs.explain ?? '', {
          ...rated(`flag:${explained}`),
          rating: 'helpful',
        })
      ).ok,
    ).toBe(true);
    // Only the reviewer holding the case rates it (spec 07c: supervisors read).
    const peters = await loadCopilot(client(), CASES.peters);
    if (!peters.ok) throw new Error('not ok');
    const notHolder = await rateOutput(client(), peters.data.jobs.summarize ?? '', {
      block: 'overview',
      rating: 'helpful',
      reason: null,
      note: null,
    });
    expect(notHolder.ok || notHolder.error).toMatchObject({ problem: { status: 403 } });

    const unknown = await rateOutput(client(), '00000000-0000-4000-8000-000000000000', {
      block: 'overview',
      rating: 'helpful',
      reason: null,
      note: null,
    });
    expect(unknown.ok || unknown.error).toMatchObject({ problem: { status: 404 } });
  });

  it('reads another Commission’s case as missing', async () => {
    const result = await loadCopilot(client(), '00000000-0000-4000-8000-000000000000');
    expect(result.ok || result.error).toMatchObject({ problem: { status: 404 } });
  });
});
