import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PauseFlags } from '../src/adapter-kit/pause-flags.js';
import { ResilientCalls } from '../src/adapter-kit/resilient-calls.js';
import { burstOf, type SystemPolicy } from '../src/adapter-kit/system-policies.js';
import { UpstreamError } from '../src/adapter-kit/upstream-error.js';
import { config } from '../src/config.js';

import { createTestApp, type TestApp } from './support/test-app.js';

/** A system that is never cached, answering within 200 ms, at a rate the tests never reach. */
const ICMS_POLICY: SystemPolicy = {
  timeoutMs: 200,
  cacheTtlSeconds: null,
  ratePerMinute: 60_000,
  burst: burstOf(60_000),
  maxQueueMs: 1_000,
};
/** One call a minute and no queueing: the second call at once is refused. */
const PAYROLL_POLICY: SystemPolicy = {
  timeoutMs: 200,
  cacheTtlSeconds: null,
  ratePerMinute: 1,
  burst: 1,
  maxQueueMs: 0,
};

/**
 * The kit's resilient call (L0-R1-2): pause, breaker, rate limit and timeout around any work on a
 * system, with the policy of the system it is made to; lookups build their cache on top of it,
 * instructions use it bare. Against Valkey (pause flags, rate limit).
 */
describe('ResilientCalls', () => {
  let t: TestApp;
  let calls: ResilientCalls;
  let made: number;

  beforeAll(async () => {
    t = await createTestApp({ policies: { icms: ICMS_POLICY, payroll: PAYROLL_POLICY } });
    t.app.useLogger(false);
    calls = t.app.get(ResilientCalls);
    return () => t.close();
  });

  beforeEach(async () => {
    made = 0;
    await t.app.get(PauseFlags).resume('icms');
  });

  const answering = (value: string) => () => {
    made += 1;
    return Promise.resolve(value);
  };
  const failing = () => {
    made += 1;
    return Promise.reject(new UpstreamError('upstream-error', 'Stub answered 503'));
  };

  it('answers what the work answers, every time: nothing is cached', async () => {
    expect(await calls.call('icms', answering('CASE-1'))).toEqual({
      outcome: 'answered',
      value: 'CASE-1',
    });
    expect(await calls.call('icms', answering('CASE-1'))).toEqual({
      outcome: 'answered',
      value: 'CASE-1',
    });
    expect(made).toBe(2);
    expect((await t.cacheKeys()).filter((key) => key.startsWith('icms:'))).toEqual([]);
  });

  it('answers an upstream failure as unavailable with its reason', async () => {
    const rateLimited = () => Promise.reject(new UpstreamError('rate-limited', 'Stub 429'));

    expect(await calls.call('icms', failing)).toEqual({
      outcome: 'unavailable',
      reason: 'upstream-error',
    });
    expect(await calls.call('icms', rateLimited)).toEqual({
      outcome: 'unavailable',
      reason: 'rate-limited',
    });
    await calls.call('icms', answering('ok'));
  });

  it('times the work out, aborting its signal', async () => {
    let aborted = false;
    const started = performance.now();

    const outcome = await calls.call(
      'icms',
      (signal) =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    );

    expect(outcome).toEqual({ outcome: 'unavailable', reason: 'timeout' });
    expect(aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
    await calls.call('icms', answering('ok'));
  });

  it('does not call a paused system', async () => {
    await t.app.get(PauseFlags).pause('icms');

    expect(await calls.call('icms', answering('ok'))).toEqual({
      outcome: 'unavailable',
      reason: 'paused',
    });
    expect(made).toBe(0);
  });

  it("queues for the system's rate limit, refusing past the max wait without calling", async () => {
    expect(await calls.call('payroll', answering('first'))).toMatchObject({ outcome: 'answered' });

    expect(await calls.call('payroll', answering('second'))).toEqual({
      outcome: 'unavailable',
      reason: 'rate-limited',
    });
    expect(made).toBe(1);
  });

  it('lets an unexpected error (not the upstream) propagate', async () => {
    const bug = new TypeError('a bug');

    await expect(calls.call('icms', () => Promise.reject(bug))).rejects.toBe(bug);
  });

  // Last: it opens the breaker, which only the clock moving past the cool-down closes.
  it("opens the system's breaker after consecutive failures, then fails fast until a probe", async () => {
    // A success first, so earlier tests' failures do not count towards this run.
    await calls.call('icms', () => Promise.resolve('ok'));
    for (let call = 0; call < config.BREAKER_FAILURE_THRESHOLD; call += 1) {
      await calls.call('icms', failing);
    }
    expect(made).toBe(config.BREAKER_FAILURE_THRESHOLD);

    expect(await calls.call('icms', answering('ok'))).toEqual({
      outcome: 'unavailable',
      reason: 'breaker-open',
    });
    expect(made).toBe(config.BREAKER_FAILURE_THRESHOLD);
    // Another system's calls go through: each has its own breaker.
    expect(await calls.call('hr-suppliers', answering('ok'))).toMatchObject({
      outcome: 'answered',
    });

    t.clock.advance(config.BREAKER_COOLDOWN_MS + 1);
    expect(await calls.call('icms', answering('ok'))).toEqual({ outcome: 'answered', value: 'ok' });
  });
});
