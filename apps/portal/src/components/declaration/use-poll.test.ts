// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PollOptions, usePoll } from './use-poll';

const INTERVAL = 100;

/** A read the test answers by hand. */
function heldReads() {
  const answers: ((value: string) => void)[] = [];
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        answers.push(resolve);
      }),
  );
  return { read, answers };
}

function renderPoll(options: Partial<PollOptions<string>> & Pick<PollOptions<string>, 'read'>) {
  const onRead = vi.fn<(value: string | null) => boolean>(() => false);
  const onGiveUp = vi.fn();
  const props: PollOptions<string> = {
    pollKey: 'a',
    onRead,
    onGiveUp,
    intervalMs: INTERVAL,
    limit: 3,
    ...options,
  };
  const hook = renderHook((current: PollOptions<string>) => usePoll(current), {
    initialProps: props,
  });
  return { ...hook, props, onRead: props.onRead, onGiveUp: props.onGiveUp };
}

/** Lets the interval pass and any answered read settle. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(INTERVAL);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePoll', () => {
  it('does not read while the key is null', async () => {
    const read = vi.fn(() => Promise.resolve('x'));
    renderPoll({ read, pollKey: null });

    await tick();
    await tick();

    expect(read).not.toHaveBeenCalled();
  });

  it('stops once onRead says there is nothing left to wait for', async () => {
    const read = vi.fn(() => Promise.resolve('done'));
    const onRead = vi.fn((value: string | null) => value === 'done');
    const { onGiveUp } = renderPoll({ read, onRead });

    await tick();
    await tick();
    await tick();

    expect(read).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('done');
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('gives up once after the limit of reads, counting a read that throws as no change', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('pending')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue('pending');
    const { onRead, onGiveUp } = renderPoll({ read, limit: 3 });

    await tick();
    await tick();
    expect(onGiveUp).not.toHaveBeenCalled();
    await tick();
    await tick();
    await tick();

    expect(read).toHaveBeenCalledTimes(3);
    expect(onRead).toHaveBeenNthCalledWith(2, null);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('drops an answer that arrives after the key changed', async () => {
    const { read, answers } = heldReads();
    const { rerender, props, onRead } = renderPoll({ read });

    await tick();
    expect(answers).toHaveLength(1);
    rerender({ ...props, pollKey: 'b' });
    await act(async () => {
      answers[0]?.('stale');
      await Promise.resolve();
    });

    expect(onRead).not.toHaveBeenCalled();
  });

  it('drops an answer that arrives after the component left', async () => {
    const { read, answers } = heldReads();
    const { unmount, onRead, onGiveUp } = renderPoll({ read, limit: 1 });

    await tick();
    unmount();
    await act(async () => {
      answers[0]?.('late');
      await Promise.resolve();
    });

    expect(onRead).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('starts the count over when the key changes', async () => {
    const read = vi.fn(() => Promise.resolve('pending'));
    const { rerender, props, onGiveUp } = renderPoll({ read, limit: 3 });

    await tick();
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
    rerender({ ...props, pollKey: 'b' });
    await tick();
    await tick();
    expect(onGiveUp).not.toHaveBeenCalled();
    await tick();

    // Two reads under the first key, then a full three under the new one.
    expect(read).toHaveBeenCalledTimes(5);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callbacks without starting over', async () => {
    const read = vi.fn(() => Promise.resolve('pending'));
    const { rerender, props } = renderPoll({ read, limit: 5 });

    await tick();
    const later = vi.fn(() => true);
    rerender({ ...props, onRead: later });
    await tick();

    expect(later).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
