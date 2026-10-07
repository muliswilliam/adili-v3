import { Inject, Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  circuitBreaker,
  type CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  handleAll,
} from 'cockatiel';

import { SYSTEMS, type System } from '../db/schema.js';

export const BREAKER_OPTIONS = Symbol('BREAKER_OPTIONS');

export const BREAKER_STATES = ['closed', 'open', 'half-open'] as const;
/** `closed`: calls go through. `open`: calls fail fast. `half-open`: the next call is a probe. */
export type BreakerState = (typeof BREAKER_STATES)[number];

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

  constructor(@Inject(BREAKER_OPTIONS) private readonly options: BreakerOptions) {
    metrics
      .getMeter('adili.integration')
      .createObservableGauge('adili.integration.breaker', {
        description: '1 while the adapter circuit is open, 0 otherwise',
      })
      .addCallback((result) => {
        for (const system of SYSTEMS) {
          const state = this.stateOf(system);
          result.observe(state === 'open' ? 1 : 0, {
            'adili.integration.system': system,
            'adili.integration.breaker': state,
          });
        }
      });
  }

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

  /**
   * The circuit as this instance sees it, for coverage. An open circuit past its cool-down reads
   * half-open: the next call probes the registry.
   */
  stateOf(system: System): BreakerState {
    const { policy } = this.breaker(system);
    switch (policy.state) {
      case CircuitState.Closed:
        return 'closed';
      case CircuitState.HalfOpen:
        return 'half-open';
      case CircuitState.Open:
        return this.failsFast(system) ? 'open' : 'half-open';
      case CircuitState.Isolated:
        return 'open';
    }
  }

  private breaker(system: System): Breaker {
    let breaker = this.breakers.get(system);
    if (!breaker) {
      // Only the registry's call runs inside: our own rate limit is reserved before it.
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
