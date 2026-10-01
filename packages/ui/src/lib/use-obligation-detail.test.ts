import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useObligationDetail } from './use-obligation-detail';

type Result = { status: 'ok'; id: string } | { status: 'failed' };
const failed: Result = { status: 'failed' };

describe('useObligationDetail', () => {
  it('loads nothing without an id', () => {
    const load = vi.fn(() => Promise.resolve<Result>({ status: 'ok', id: 'a' }));
    const { result } = renderHook(() => useObligationDetail(null, load, failed));

    expect(result.current.detail).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('is null while loading, then the result', async () => {
    const load = vi.fn((id: string) => Promise.resolve<Result>({ status: 'ok', id }));
    const { result } = renderHook(() => useObligationDetail('a', load, failed));

    expect(result.current.detail).toBeNull();
    await waitFor(() => {
      expect(result.current.detail).toEqual({ status: 'ok', id: 'a' });
    });
  });

  it('settles a rejected load as failed, and loads again on retry', async () => {
    const load = vi
      .fn<(id: string) => Promise<Result>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'ok', id: 'a' });
    const { result } = renderHook(() => useObligationDetail('a', load, failed));

    await waitFor(() => {
      expect(result.current.detail).toEqual(failed);
    });
    act(() => {
      result.current.retry();
    });
    expect(result.current.detail).toBeNull();
    await waitFor(() => {
      expect(result.current.detail).toEqual({ status: 'ok', id: 'a' });
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops a reply for an id no longer shown', async () => {
    let resolveFirst: (value: Result) => void = () => undefined;
    const load = vi
      .fn<(id: string) => Promise<Result>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: 'ok', id: 'b' });
    const { result, rerender } = renderHook(({ id }) => useObligationDetail(id, load, failed), {
      initialProps: { id: 'a' },
    });

    rerender({ id: 'b' });
    await waitFor(() => {
      expect(result.current.detail).toEqual({ status: 'ok', id: 'b' });
    });
    await act(async () => {
      resolveFirst({ status: 'ok', id: 'a' });
      await Promise.resolve();
    });
    expect(result.current.detail).toEqual({ status: 'ok', id: 'b' });
  });
});
