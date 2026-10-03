import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutosave } from './use-autosave';

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
});
