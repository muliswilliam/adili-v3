import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInFrame } from './use-in-frame';

describe('useInFrame', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is false at the top level', () => {
    expect(renderHook(() => useInFrame()).result.current).toBe(false);
  });

  it('is true inside a frame', () => {
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    expect(renderHook(() => useInFrame()).result.current).toBe(true);
  });
});
