import { Inject, Injectable, Logger } from '@nestjs/common';

export const BREAKER_OPTIONS = Symbol('BREAKER_OPTIONS');

export interface BreakerOptions {
  /** Consecutive transport failures that open a provider's breaker. */
  failureThreshold: number;
  /** How long an open breaker fails calls fast before letting one probe through. */
  cooldownMs: number;
  /** Epoch ms; tests pass a fake clock. */
  now?: () => number;
}

type State =
  { kind: 'closed'; failures: number } | { kind: 'open'; until: number } | { kind: 'half-open' };

/**
 * A circuit breaker per provider (spec 07c S6), in this process: after `failureThreshold`
 * consecutive transport failures (timeouts, rate limits, outages) calls fail fast for
 * `cooldownMs`, so jobs end with `provider-unavailable` instead of queueing retries against a
 * provider that is down. Then one call probes: success closes the breaker, failure reopens it.
 * Answers of any kind, refusals and invalid outputs included, count as the provider being up.
 */
@Injectable()
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private readonly states = new Map<string, State>();

  private readonly now: () => number;

  constructor(@Inject(BREAKER_OPTIONS) private readonly options: BreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Whether a call to `provider` may go ahead; claims the probe when the cooldown is over. */
  tryAcquire(provider: string): boolean {
    const state = this.state(provider);
    if (state.kind === 'closed') return true;
    if (state.kind === 'half-open') return false;
    if (this.now() < state.until) return false;
    this.states.set(provider, { kind: 'half-open' });
    return true;
  }

  recordSuccess(provider: string): void {
    if (this.state(provider).kind !== 'closed') {
      this.logger.log({ provider }, 'Provider circuit closed');
    }
    this.states.set(provider, { kind: 'closed', failures: 0 });
  }

  recordFailure(provider: string): void {
    const state = this.state(provider);
    const failures = state.kind === 'closed' ? state.failures + 1 : this.options.failureThreshold;
    if (failures < this.options.failureThreshold) {
      this.states.set(provider, { kind: 'closed', failures });
      return;
    }
    if (state.kind !== 'open') {
      this.logger.warn({ provider, cooldownMs: this.options.cooldownMs }, 'Provider circuit open');
    }
    this.states.set(provider, { kind: 'open', until: this.now() + this.options.cooldownMs });
  }

  /** Releases a probe that ended without an answer either way (e.g. a cancelled call). */
  release(provider: string): void {
    if (this.state(provider).kind === 'half-open') {
      this.states.set(provider, { kind: 'open', until: this.now() });
    }
  }

  private state(provider: string): State {
    return this.states.get(provider) ?? { kind: 'closed', failures: 0 };
  }
}
