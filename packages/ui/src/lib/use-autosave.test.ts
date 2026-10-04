import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutosaveFailure, AutosaveQueue, useAutosave } from './use-autosave';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets awaited saves settle inside act. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-10-03T07:42:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is idle until something changes', () => {
    const save = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAutosave(save));

    expect(result.current.status).toBe('idle');
    expect(result.current.savedAt).toBeNull();
  });

  it('saves the latest value once typing pauses, then says when', async () => {
    const save = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    const { result } = renderHook(() => useAutosave(save, { delayMs: 1_000 }));

    act(() => {
      result.current.change('a');
    });
    expect(result.current.status).toBe('saving');
    act(() => {
      vi.advanceTimersByTime(600);
      result.current.change('ab');
      vi.advanceTimersByTime(600);
    });
    expect(save).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(400);
    });
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
    expect(result.current.status).toBe('saved');
    expect(result.current.savedAt?.toISOString()).toBe('2026-10-03T07:42:01.600Z');
  });

  it('sends one save at a time and the edits made meanwhile after it', async () => {
    const first = deferred();
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, { delayMs: 100 }));

    act(() => {
      result.current.change('one');
      vi.advanceTimersByTime(100);
    });
    act(() => {
      result.current.change('two');
      result.current.change('three');
      vi.advanceTimersByTime(100);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saving');

    first.resolve();
    await settle();
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('three');
    expect(result.current.status).toBe('saved');
  });

  it('retries a failed save with the latest value, backing off', async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, { delayMs: 100 }));

    act(() => {
      result.current.change('x');
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(result.current.status).toBe('retrying');

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(save).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('retrying');

    act(() => {
      result.current.change('xy');
      vi.advanceTimersByTime(2_000);
    });
    await settle();

    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith('xy');
    expect(result.current.status).toBe('saved');
  });

  it('stops on a refusal the same value would meet again, and saves the next edit', async () => {
    const refusal = new AutosaveFailure('error', 'ncr-approved');
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(refusal)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, { delayMs: 100 }));

    act(() => {
      result.current.change('x');
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(result.current.status).toBe('error');
    expect(result.current.failure).toBe(refusal);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.change('xy');
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(save).toHaveBeenLastCalledWith('xy');
    expect(result.current.status).toBe('saved');
    expect(result.current.failure).toBeNull();
  });

  it('stops saving after a conflict until reset', async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new AutosaveFailure('conflict'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, { delayMs: 100 }));

    act(() => {
      result.current.change('mine');
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(result.current.status).toBe('conflict');

    act(() => {
      result.current.change('more');
      vi.advanceTimersByTime(60_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('conflict');

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    act(() => {
      result.current.change('after reload');
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(save).toHaveBeenLastCalledWith('after reload');
  });

  it('tries once more when the save in flight at unmount fails', async () => {
    const first = deferred();
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave(save, { delayMs: 10 }));

    act(() => {
      result.current.change('only');
      vi.advanceTimersByTime(10);
    });
    unmount();
    first.reject(new Error('offline'));
    await settle();
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('only');
  });

  describe('a save still in flight at reset', () => {
    async function inFlightAtReset(outcome: (pending: ReturnType<typeof deferred>) => void) {
      const first = deferred();
      const save = vi
        .fn<(value: string) => Promise<void>>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue(undefined);
      const hook = renderHook(() => useAutosave(save, { delayMs: 10 }));
      act(() => {
        hook.result.current.change('before reload');
        vi.advanceTimersByTime(10);
      });
      act(() => {
        hook.result.current.reset();
      });
      outcome(first);
      await settle();
      await settle();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      await settle();
      return { save, result: hook.result };
    }

    it('does not mark the reloaded state saved when it succeeds', async () => {
      const { result } = await inFlightAtReset((first) => {
        first.resolve();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.savedAt).toBeNull();
    });

    it('does not stop the reloaded state when it is refused', async () => {
      const { result } = await inFlightAtReset((first) => {
        first.reject(new AutosaveFailure('conflict'));
      });

      expect(result.current.status).toBe('idle');
      act(() => {
        result.current.change('after reload');
      });
      expect(result.current.status).toBe('saving');
    });

    it('does not send its value again when it fails', async () => {
      const { save, result } = await inFlightAtReset((first) => {
        first.reject(new Error('offline'));
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('idle');
    });

    it('lets an edit made after the reset go once it settles', async () => {
      const first = deferred();
      const save = vi
        .fn<(value: string) => Promise<void>>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue(undefined);
      const { result } = renderHook(() => useAutosave(save, { delayMs: 10 }));
      act(() => {
        result.current.change('before reload');
        vi.advanceTimersByTime(10);
      });
      act(() => {
        result.current.reset();
        result.current.change('after reload');
        vi.advanceTimersByTime(10);
      });
      expect(save).toHaveBeenCalledTimes(1);

      first.resolve();
      await settle();
      await settle();

      expect(save).toHaveBeenLastCalledWith('after reload');
      expect(result.current.status).toBe('saved');
    });
  });

  it('does not send the edit waiting at unmount when the save in flight meets a conflict', async () => {
    const first = deferred();
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave(save, { delayMs: 10 }));

    act(() => {
      result.current.change('mine');
      vi.advanceTimersByTime(10);
      result.current.change('more');
    });
    unmount();
    first.reject(new AutosaveFailure('conflict'));
    await settle();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('waits out the backoff even when flushed', async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, { delayMs: 10 }));

    act(() => {
      result.current.change('x');
      vi.advanceTimersByTime(10);
    });
    await settle();
    act(() => {
      result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('lets a newer edit finish its pause after a refusal', async () => {
    const first = deferred();
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, { delayMs: 100 }));

    act(() => {
      result.current.change('refused');
      vi.advanceTimersByTime(100);
      result.current.change('newer');
    });
    first.reject(new AutosaveFailure('error'));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(save).toHaveBeenLastCalledWith('newer');
  });

  it('saves at once on flush, e.g. when the editor loses focus', async () => {
    const save = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    const { result } = renderHook(() => useAutosave(save, { delayMs: 5_000 }));

    act(() => {
      result.current.change('now');
      result.current.flush();
    });
    await settle();

    expect(save).toHaveBeenCalledWith('now');
    expect(result.current.status).toBe('saved');
  });

  it('does nothing on flush when nothing changed', () => {
    const save = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAutosave(save));

    act(() => {
      result.current.flush();
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('sends a waiting edit when it unmounts, so leaving the page does not lose it', () => {
    const save = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    const { result, unmount } = renderHook(() => useAutosave(save));

    act(() => {
      result.current.change('last words');
    });
    unmount();

    expect(save).toHaveBeenCalledWith('last words');
  });

  it('sends the edit waiting at unmount only after the save in flight, so it lands last', async () => {
    const first = deferred();
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave(save, { delayMs: 10 }));

    act(() => {
      result.current.change('older');
      vi.advanceTimersByTime(10);
      result.current.change('newer');
    });
    unmount();
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve();
    await settle();
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('newer');
  });

  it('uses the latest save function', async () => {
    const first = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    const second = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    const { result, rerender } = renderHook(({ save }) => useAutosave(save, { delayMs: 10 }), {
      initialProps: { save: first },
    });

    rerender({ save: second });
    act(() => {
      result.current.change('v');
      vi.advanceTimersByTime(10);
    });
    await settle();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('v');
  });

  it('takes back a value parked at dispose when revived, so it never lands after a newer edit', async () => {
    const first = deferred();
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const queue = new AutosaveQueue<string>();
    queue.configure(save, 10);

    queue.change('older');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    queue.change('parked');
    queue.dispose();
    queue.revive(); // a development remount while 'older' is in flight
    queue.change('newer');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    first.resolve();
    await settle();
    await settle();

    // 'newer' replaced 'parked'; nothing older lands after it.
    expect(save.mock.calls.map(([value]) => value)).toEqual(['older', 'newer']);
    expect(queue.getSnapshot().status).toBe('saved');
  });
});
