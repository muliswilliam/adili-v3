import { describe, expect, it } from 'vitest';

import { BreakerOpenError, CircuitBreaker } from './circuit-breaker.js';
import type { Clock } from './clock.js';

class ManualClock implements Clock {
  ms = 0;
  now(): number {
    return this.ms;
  }
}

const fail = () => Promise.reject(new Error('upstream down'));
const succeed = () => Promise.resolve('ok');

function breaker(clock = new ManualClock()) {
  return {
    clock,
    breaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000 }, clock),
  };
}

async function failTimes(target: CircuitBreaker, times: number) {
  for (let i = 0; i < times; i += 1) {
    await expect(target.run(fail)).rejects.toThrow('upstream down');
  }
}

describe('CircuitBreaker', () => {
  it('passes calls through while closed', async () => {
    const { breaker: target } = breaker();

    await expect(target.run(succeed)).resolves.toBe('ok');
    expect(target.state).toBe('closed');
  });

  it('opens after the threshold of consecutive failures and then fails fast', async () => {
    const { breaker: target } = breaker();
    await failTimes(target, 3);

    let called = false;
    await expect(
      target.run(() => {
        called = true;
        return succeed();
      }),
    ).rejects.toBeInstanceOf(BreakerOpenError);
    expect(called).toBe(false);
    expect(target.state).toBe('open');
  });

  it('counts only consecutive failures', async () => {
    const { breaker: target } = breaker();
    await failTimes(target, 2);
    await target.run(succeed);
    await failTimes(target, 2);

    expect(target.state).toBe('closed');
  });

  it('lets one probe through after the cool-down and closes when it succeeds', async () => {
    const { breaker: target, clock } = breaker();
    await failTimes(target, 3);
    clock.ms += 999;
    await expect(target.run(succeed)).rejects.toBeInstanceOf(BreakerOpenError);

    clock.ms += 1;
    expect(target.state).toBe('half-open');
    await expect(target.run(succeed)).resolves.toBe('ok');

    expect(target.state).toBe('closed');
  });

  it('opens again for a full cool-down when the probe fails', async () => {
    const { breaker: target, clock } = breaker();
    await failTimes(target, 3);
    clock.ms += 1_000;

    await expect(target.run(fail)).rejects.toThrow('upstream down');

    expect(target.state).toBe('open');
    clock.ms += 999;
    await expect(target.run(succeed)).rejects.toBeInstanceOf(BreakerOpenError);
    clock.ms += 1;
    await expect(target.run(succeed)).resolves.toBe('ok');
  });

  it('fails fast for other calls while the probe is in flight', async () => {
    const { breaker: target, clock } = breaker();
    await failTimes(target, 3);
    clock.ms += 1_000;
    let finishProbe!: (value: string) => void;
    const probe = target.run(() => new Promise<string>((resolve) => (finishProbe = resolve)));

    await expect(target.run(succeed)).rejects.toBeInstanceOf(BreakerOpenError);

    finishProbe('ok');
    await expect(probe).resolves.toBe('ok');
    expect(target.state).toBe('closed');
  });
});
