// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ConfirmOutcome, useConfirmAction } from './confirm-action';
import { signInAgain } from './sign-in';

vi.mock('./sign-in', () => ({ signInAgain: vi.fn() }));

const signIn = vi.mocked(signInAgain);

beforeEach(() => {
  signIn.mockReset();
});

type Problem = 'gone' | 'unavailable';

function hook(action: () => Promise<ConfirmOutcome<Problem>>) {
  return renderHook(() => useConfirmAction<Problem>({ action, unavailable: 'unavailable' }));
}

describe('useConfirmAction', () => {
  it('closes once the action is done', async () => {
    const { result } = hook(() => Promise.resolve({ status: 'done' }));
    act(() => {
      result.current.setOpen(true);
    });

    await act(() => result.current.run());

    expect(result.current).toMatchObject({ open: false, busy: false, problem: null });
  });

  it('keeps the dialog open with the problem, and clears it when closed', async () => {
    const { result } = hook(() => Promise.resolve({ status: 'problem', problem: 'gone' }));
    act(() => {
      result.current.setOpen(true);
    });

    await act(() => result.current.run());
    expect(result.current).toMatchObject({ open: true, busy: false, problem: 'gone' });

    act(() => {
      result.current.setOpen(false);
    });
    expect(result.current.problem).toBeNull();
  });

  it('says unavailable when the action throws', async () => {
    const { result } = hook(() => Promise.reject(new Error('network')));

    await act(() => result.current.run());

    expect(result.current.problem).toBe('unavailable');
  });

  it('sends a signed-out declarant to sign in, still busy', async () => {
    const { result } = hook(() => Promise.resolve({ status: 'unauthenticated' }));

    await act(() => result.current.run());

    expect(signIn).toHaveBeenCalledOnce();
    expect(result.current.busy).toBe(true);
  });
});
