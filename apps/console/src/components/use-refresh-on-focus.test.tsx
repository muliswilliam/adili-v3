// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRefreshOnFocus } from './use-refresh-on-focus';

describe('useRefreshOnFocus', () => {
  it('refreshes each time the window regains focus', () => {
    const refresh = vi.fn();
    renderHook(() => {
      useRefreshOnFocus(refresh);
    });
    window.dispatchEvent(new FocusEvent('focus'));
    window.dispatchEvent(new FocusEvent('focus'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ refresh }) => {
        useRefreshOnFocus(refresh);
      },
      { initialProps: { refresh: first } },
    );
    rerender({ refresh: second });
    window.dispatchEvent(new FocusEvent('focus'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => {
      useRefreshOnFocus(refresh);
    });
    unmount();
    window.dispatchEvent(new FocusEvent('focus'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
