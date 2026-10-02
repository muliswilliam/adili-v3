import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCopilot, rateOutput, readCopilotView, refreshCopilot } from './copilot.server';
import {
  MOCK_COPILOT_DELAY_MS,
  MOCK_FLAG_IDS,
  mockSummary,
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

  it('refuses a refresh by someone not holding the case, and when AI is not enabled', async () => {
    const theirs = await refreshCopilot(client(), CASES.peters);
    expect(theirs.ok || theirs.error).toMatchObject({ problem: { status: 403 } });

    setMockCopilot(CASES.mine, { status: 'not-enabled', summary: null, explanations: null });
    const off = await refreshCopilot(client(), CASES.mine);
    expect(off.ok || off.error).toMatchObject({ problem: { status: 409 } });
  });

  it("keeps one rating per reviewer per output and lists only the caller's", async () => {
    const loaded = await loadCopilot(client(), CASES.mine);
    if (!loaded.ok) throw new Error('not ok');
    const jobId = loaded.data.jobs.summarize ?? '';
    expect(
      (await rateOutput(client(), jobId, { rating: 'helpful', reason: null, note: null })).ok,
    ).toBe(true);
    await rateOutput(client(), jobId, { rating: 'not-helpful', reason: 'unclear', note: 'Long' });

    const mine = await loadCopilot(client(), CASES.mine);
    expect(mine.ok && mine.data.feedback).toEqual([{ jobId, rating: 'not-helpful' }]);
    const other = await loadCopilot(mockReviewClient('someone-else', 'Peter'), CASES.mine);
    expect(other.ok && other.data.feedback).toEqual([]);
    // Only the reviewer holding the case rates it (spec 07c: supervisors read).
    const peters = await loadCopilot(client(), CASES.peters);
    if (!peters.ok) throw new Error('not ok');
    const notHolder = await rateOutput(client(), peters.data.jobs.summarize ?? '', {
      rating: 'helpful',
      reason: null,
      note: null,
    });
    expect(notHolder.ok || notHolder.error).toMatchObject({ problem: { status: 403 } });

    const unknown = await rateOutput(client(), '00000000-0000-4000-8000-000000000000', {
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
