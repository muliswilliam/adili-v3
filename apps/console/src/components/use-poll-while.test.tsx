// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNowAt } from './use-now-at';
import { usePollWhile } from './use-poll-while';

const invalidate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

beforeEach(() => {
  vi.useFakeTimers();
  invalidate.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePollWhile', () => {
  it('reloads while active, at most the given times, then says it stopped', () => {
    const { result } = renderHook(() => usePollWhile(true, 1000, 3));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(result.current.exhausted).toBe(true);
  });

  it('starts another round on restart', () => {
    const { result } = renderHook(() => usePollWhile(true, 1000, 2));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      result.current.restart();
    });
    expect(result.current.exhausted).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Two, the restart's own reload, and two more.
    expect(invalidate).toHaveBeenCalledTimes(5);
  });

  it('does nothing while inactive, and stops once the page moved on', () => {
    const { result, rerender } = renderHook(({ active }) => usePollWhile(active, 1000, 10), {
      initialProps: { active: false },
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(invalidate).not.toHaveBeenCalled();
    rerender({ active: true });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(result.current.exhausted).toBe(false);
  });
});

describe('useNowAt', () => {
  it('reads the server time until the moment passes, then turns', () => {
    const serverNow = Date.parse('2026-10-02T09:00:00Z');
    vi.setSystemTime(serverNow);
    const at = serverNow + 60_000;
    const { result } = renderHook(() => useNowAt(serverNow, at));
    expect(result.current).toBe(serverNow);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBeGreaterThanOrEqual(at);
  });

  it('keeps the server time when nothing turns', () => {
    const { result } = renderHook(() => useNowAt(1000, null));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(1000);
  });
});
