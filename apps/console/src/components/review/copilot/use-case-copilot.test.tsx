// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Copilot, readCopilotView } from '../../../server/copilot.server';
import { mockSummary } from '../../../server/review/copilot-mock.server';
import type { ServiceResult } from '../../../server/service-call';
import { type CopilotApi, POLL_STOP_AFTER_MS, pollDelay, useCaseCopilot } from './use-case-copilot';

const CASE = 'ca5e0000-0000-4000-8000-000000000001';
const JOB = 'aaaa0000-0000-4000-8000-000000000001';

const copilot = (status: Copilot['status'], over: Partial<Copilot> = {}): Copilot => ({
  ...readCopilotView({
    status,
    forVersionId: CASE,
    generatedAt: '2026-10-01T09:00:00Z',
    failureReason: null,
    summary: status === 'ready' || status === 'stale' ? mockSummary('2026-10-01T09:00:00Z') : null,
    explanations: null,
    jobs: { summarize: JOB, explain: null },
    feedback: [],
  }),
  ...over,
});

const ok = (data: Copilot): ServiceResult<Copilot> => ({ ok: true, data });
const down: ServiceResult<Copilot> = { ok: false, error: { kind: 'unavailable', detail: null } };

function fakeApi(reads: ServiceResult<Copilot>[], last = reads.at(-1) ?? down) {
  const read = vi.fn(() => Promise.resolve(reads.shift() ?? last));
  const refresh = vi.fn(() => Promise.resolve(ok(copilot('pending'))));
  const rate = vi.fn(() => Promise.resolve({ ok: true, data: null } as ServiceResult<null>));
  return { read, refresh, rate } satisfies CopilotApi;
}

/** Lets pending promises settle. */
const settle = () => act(() => Promise.resolve());
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useCaseCopilot', () => {
  it('backs off 2, 3, 5, 8, 13, then 15 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(pollDelay)).toEqual([
      2000, 3000, 5000, 8000, 13000, 15000, 15000,
    ]);
  });

  it('reads once, then polls while pending until ready', async () => {
    const api = fakeApi([ok(copilot('pending')), ok(copilot('pending')), ok(copilot('ready'))]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.copilot?.status).toBe('pending');
    await wait(2000);
    expect(api.read).toHaveBeenCalledTimes(2);
    await wait(3000);
    expect(result.current.copilot?.status).toBe('ready');
    await wait(60_000);
    expect(api.read).toHaveBeenCalledTimes(3);
  });

  it('reads a not-enabled copilot once a minute, and polls quickly once a policy approval requested it (Q29)', async () => {
    const api = fakeApi([
      ok(copilot('not-enabled')),
      ok(copilot('not-enabled')),
      ok(copilot('pending')),
      ok(copilot('ready')),
    ]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.copilot?.status).toBe('not-enabled');
    await wait(59_000);
    expect(api.read).toHaveBeenCalledTimes(1);
    await wait(1_000);
    expect(api.read).toHaveBeenCalledTimes(2);
    await wait(60_000);
    expect(result.current.copilot?.status).toBe('pending');
    await wait(2_000);
    expect(result.current.copilot?.status).toBe('ready');
    await wait(300_000);
    expect(api.read).toHaveBeenCalledTimes(4);
  });

  it('skips the once-a-minute read of a not-enabled copilot while the page is hidden (Q29, N34)', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const api = fakeApi([ok(copilot('not-enabled'))]);
      renderHook(() => useCaseCopilot(CASE, api));
      await settle();
      await wait(180_000);
      expect(api.read).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue('visible');
      await wait(60_000);
      expect(api.read).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it('stops after two minutes, and Check again starts over', async () => {
    const api = fakeApi([ok(copilot('stale'))]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    await wait(POLL_STOP_AFTER_MS - 1);
    expect(result.current.stopped).toBe(false);
    await wait(1);
    expect(result.current.stopped).toBe(true);
    const polls = api.read.mock.calls.length;
    await wait(60_000);
    expect(api.read).toHaveBeenCalledTimes(polls);

    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.stopped).toBe(false);
    expect(api.read).toHaveBeenCalledTimes(polls + 1);
    await wait(2000);
    expect(api.read).toHaveBeenCalledTimes(polls + 2);
  });

  it('keeps polling through a failed poll', async () => {
    const api = fakeApi([ok(copilot('pending')), down, ok(copilot('ready'))]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    await wait(2000);
    expect(result.current.copilot?.status).toBe('pending');
    await wait(3000);
    expect(result.current.copilot?.status).toBe('ready');
  });

  it('stops polling and says the session ended when a poll is unauthenticated (Q8)', async () => {
    const signedOut: ServiceResult<Copilot> = {
      ok: false,
      error: { kind: 'unauthenticated' },
    };
    const api = fakeApi([ok(copilot('pending')), signedOut]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.sessionEnded).toBe(false);
    await wait(2000);
    expect(result.current.sessionEnded).toBe(true);
    const polls = api.read.mock.calls.length;
    await wait(60_000);
    expect(api.read).toHaveBeenCalledTimes(polls);
  });

  it('says why the first read failed, and tries again', async () => {
    const api = fakeApi([down, ok(copilot('ready'))]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.error).toBe('unavailable');
    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.error).toBeNull();
    expect(result.current.copilot?.status).toBe('ready');
  });

  it('says the first read failed when the call itself throws, instead of loading forever', async () => {
    const api = fakeApi([], ok(copilot('ready')));
    api.read.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.error).toBe('unavailable');
    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.copilot?.status).toBe('ready');
  });

  it('polls on after Check again when that read throws', async () => {
    const api = fakeApi([ok(copilot('stale'))]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    await wait(POLL_STOP_AFTER_MS);
    expect(result.current.stopped).toBe(true);
    api.read.mockRejectedValueOnce(new Error('Failed to fetch'));
    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.stopped).toBe(false);
    const polls = api.read.mock.calls.length;
    await wait(2000);
    expect(api.read).toHaveBeenCalledTimes(polls + 1);
  });

  it('stops refreshing and says so when the refresh call throws', async () => {
    const api = fakeApi([ok(copilot('ready'))]);
    api.refresh.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    let problem: string | null = null;
    await act(async () => {
      problem = await result.current.refresh();
    });
    expect(problem).toBe('Copilot could not be refreshed. Try again.');
    expect(result.current.refreshing).toBe(false);
  });

  it('reads a 404 as not found', async () => {
    const api = fakeApi([
      { ok: false, error: { kind: 'problem', problem: { type: 'x', title: 'x', status: 404 } } },
    ]);
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.error).toBe('not-found');
  });

  it('refreshes: the view goes pending and polling starts', async () => {
    const api = fakeApi(
      [ok(copilot('failed', { failureReason: 'provider' }))],
      ok(copilot('ready')),
    );
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    let problem: string | null = 'unset';
    await act(async () => {
      problem = await result.current.refresh();
    });
    expect(problem).toBeNull();
    expect(result.current.copilot?.status).toBe('pending');
    await wait(2000);
    expect(result.current.copilot?.status).toBe('ready');
  });

  it('says why a refresh was refused, and reads where it stands on 409', async () => {
    const api = fakeApi([ok(copilot('ready'))], ok(copilot('pending')));
    api.refresh.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'problem', problem: { type: 'x', title: 'x', status: 409 } },
    });
    api.refresh.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'problem', problem: { type: 'x', title: 'x', status: 403 } },
    });
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    let problem: string | null = null;
    await act(async () => {
      problem = await result.current.refresh();
    });
    expect(problem).toBe('Already updating.');
    expect(result.current.copilot?.status).toBe('pending');
    await act(async () => {
      problem = await result.current.refresh();
    });
    expect(problem).toBe('Only the reviewer holding the case or a supervisor can refresh it.');
  });

  it('starts from the view it is given without reading it again', async () => {
    const api = fakeApi([]);
    renderHook(() => useCaseCopilot(CASE, api, copilot('ready')));
    await settle();
    expect(api.read).not.toHaveBeenCalled();
  });

  it("keeps the caller's ratings per block: from the view, then as saved", async () => {
    const api = fakeApi(
      [],
      ok(copilot('ready', { feedback: [{ jobId: JOB, block: 'overview', rating: 'helpful' }] })),
    );
    const { result } = renderHook(() => useCaseCopilot(CASE, api));
    await settle();
    expect(result.current.ratingOf(JOB, 'overview')).toEqual({
      rating: 'helpful',
      reason: null,
      note: null,
    });
    expect(result.current.ratingOf(JOB, 'changes')).toBeNull();
    const feedback = { rating: 'not-helpful', reason: 'too-long', note: null } as const;
    await act(async () => {
      await result.current.rate(JOB, 'changes', feedback);
    });
    expect(api.rate).toHaveBeenCalledWith(JOB, 'changes', feedback);
    expect(result.current.ratingOf(JOB, 'changes')).toEqual(feedback);
    expect(result.current.ratingOf(JOB, 'overview')?.rating).toBe('helpful');

    api.rate.mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } });
    await expect(
      act(() =>
        result.current.rate(JOB, 'changes', { rating: 'helpful', reason: null, note: null }),
      ),
    ).rejects.toThrow();
    expect(result.current.ratingOf(JOB, 'changes')).toEqual(feedback);
  });
});
