import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIdempotencyKey } from './use-idempotency-key';

describe('useIdempotencyKey', () => {
  it('keeps the key while the body is unchanged', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.keyFor({ note: 'a', record: 'r1' });
    rerender();
    expect(result.current.keyFor({ note: 'a', record: 'r1' })).toBe(first);
  });

  it('gives a changed body a new key, and a body changed back another one', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.keyFor({ record: 'r1' });
    const second = result.current.keyFor({ record: 'r2' });
    expect(second).not.toBe(first);
    expect(result.current.keyFor({ record: 'r1' })).not.toBe(first);
  });

  it('takes string bodies as they are', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(result.current.keyFor('day')).toBe(result.current.keyFor('day'));
  });

  it('starts over after reset', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.keyFor('same');
    result.current.reset();
    expect(result.current.keyFor('same')).not.toBe(first);
  });

  it('keeps its functions across renders', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});
