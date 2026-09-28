import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keepHeartbeating } from '../../src/roster/import/heartbeats.js';

describe('keepHeartbeating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('heartbeats from the start and on an interval while work reports no progress', async () => {
    const beats: unknown[] = [];
    const done = Promise.withResolvers<string>();
    const running = keepHeartbeating(
      { heartbeat: (details) => beats.push(details) },
      () => done.promise,
      1_000,
    );

    expect(beats).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(beats).toHaveLength(4);
    done.resolve('staged');
    expect(await running).toBe('staged');
  });

  it('repeats the latest progress, and stops once the work settles', async () => {
    const beats: unknown[] = [];
    const done = Promise.withResolvers<undefined>();
    const running = keepHeartbeating(
      { heartbeat: (details) => beats.push(details) },
      (progress) => {
        progress(1_000);
        return done.promise;
      },
      1_000,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(beats).toEqual([undefined, 1_000, 1_000]);

    done.reject(new Error('stopped'));
    await expect(running).rejects.toThrow('stopped');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(beats).toHaveLength(3);
  });
});
