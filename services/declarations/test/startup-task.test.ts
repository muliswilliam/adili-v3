import type { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StartupTask } from '../src/startup-task.js';

describe('StartupTask', () => {
  const warn = vi.fn();
  const logger = { warn } as unknown as Logger;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries every minute until the work succeeds', async () => {
    const work = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValue(undefined);
    new StartupTask(logger, 'Not done', work).start();

    await vi.advanceTimersByTimeAsync(0);
    expect(work).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(work).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(work).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(work).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'Not done; retrying');
  });

  it('stops retrying once stopped', async () => {
    const work = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('unreachable'));
    const task = new StartupTask(logger, 'Not done', work);
    task.start();
    await vi.advanceTimersByTimeAsync(0);

    task.stop();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(work).toHaveBeenCalledTimes(1);
  });
});
