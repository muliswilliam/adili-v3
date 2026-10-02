import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { CircuitBreaker } from '../../src/policy/circuit-breaker.js';

function breaker() {
  let now = 0;
  const instance = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => now });
  return { instance, advance: (ms: number) => (now += ms) };
}

describe('CircuitBreaker (spec 07c S6)', () => {
  beforeAll(() => {
    const quiet = [
      vi.spyOn(Logger.prototype, 'log').mockReturnValue(undefined),
      vi.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined),
    ];
    return () => {
      for (const spy of quiet) spy.mockRestore();
    };
  });

  it('opens after consecutive failures and fails fast until the cooldown is over', () => {
    const { instance, advance } = breaker();
    for (let i = 0; i < 3; i++) {
      expect(instance.tryAcquire('anthropic')).toBe(true);
      instance.recordFailure('anthropic');
    }

    expect(instance.tryAcquire('anthropic')).toBe(false);
    expect(instance.tryAcquire('other')).toBe(true);
    advance(999);
    expect(instance.tryAcquire('anthropic')).toBe(false);
  });

  it('lets one probe through after the cooldown: success closes, failure reopens', () => {
    const { instance, advance } = breaker();
    for (let i = 0; i < 3; i++) instance.recordFailure('anthropic');
    advance(1000);

    expect(instance.tryAcquire('anthropic')).toBe(true);
    expect(instance.tryAcquire('anthropic')).toBe(false);
    instance.recordFailure('anthropic');
    expect(instance.tryAcquire('anthropic')).toBe(false);

    advance(1000);
    expect(instance.tryAcquire('anthropic')).toBe(true);
    instance.recordSuccess('anthropic');
    expect(instance.tryAcquire('anthropic')).toBe(true);
    expect(instance.tryAcquire('anthropic')).toBe(true);
  });

  it('starts counting again after a success', () => {
    const { instance } = breaker();
    instance.recordFailure('anthropic');
    instance.recordFailure('anthropic');
    instance.recordSuccess('anthropic');
    instance.recordFailure('anthropic');
    instance.recordFailure('anthropic');

    expect(instance.tryAcquire('anthropic')).toBe(true);
  });

  it('frees a probe that ended without an answer for the next call', () => {
    const { instance, advance } = breaker();
    for (let i = 0; i < 3; i++) instance.recordFailure('anthropic');
    advance(1000);
    expect(instance.tryAcquire('anthropic')).toBe(true);

    instance.release('anthropic');

    expect(instance.tryAcquire('anthropic')).toBe(true);
  });
});
