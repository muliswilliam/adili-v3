import { Inject, Injectable } from '@nestjs/common';
import {
  circuitBreaker,
  type CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  handleAll,
} from 'cockatiel';

import type { System } from '../db/schema.js';

export const BREAKER_OPTIONS = Symbol('BREAKER_OPTIONS');

export interface BreakerOptions {
  /** Consecutive failures that open a system's circuit. */
  failureThreshold: number;
  /** How long an open circuit fails fast before letting one probe through (half-open). */
  cooldownMs: number;
}

interface Breaker {
  policy: CircuitBreakerPolicy;
  /** `Date.now()` when the circuit last opened. */
  openedAt: number;
}

/**
 * One circuit breaker per system, per process: each instance learns about an outage from its
 * own failures (ADR-013).
 */
@Injectable()
export class CircuitBreakers {
  private readonly breakers = new Map<System, Breaker>();

  constructor(@Inject(BREAKER_OPTIONS) private readonly options: BreakerOptions) {}

  of(system: System): CircuitBreakerPolicy {
    return this.breaker(system).policy;
  }

  /**
   * Whether a call to `system` would be refused right now: open and still cooling down. Past
   * the cool-down the circuit still reads open until the next call probes it (half-open).
   */
  failsFast(system: System): boolean {
    const { policy, openedAt } = this.breaker(system);
    return policy.state === CircuitState.Open && Date.now() - openedAt < this.options.cooldownMs;
  }

  private breaker(system: System): Breaker {
    let breaker = this.breakers.get(system);
    if (!breaker) {
      const policy = circuitBreaker(handleAll, {
        halfOpenAfter: this.options.cooldownMs,
        breaker: new ConsecutiveBreaker(this.options.failureThreshold),
      });
      const created: Breaker = { policy, openedAt: 0 };
      policy.onBreak(() => {
        created.openedAt = Date.now();
      });
      breaker = created;
      this.breakers.set(system, breaker);
    }
    return breaker;
  }
}
