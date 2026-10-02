import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BrokenCircuitError,
  CircuitState,
  TaskCancelledError,
  timeout,
  TimeoutStrategy,
} from 'cockatiel';

import type { System, UnavailableReason } from '../db/schema.js';
import { CircuitBreakers } from './circuit-breakers.js';
import { PauseFlags } from './pause-flags.js';
import { RateLimiter } from './rate-limiter.js';
import type { UpstreamCalls } from './registry-adapter.js';
import { policyOf, SYSTEM_POLICIES, type SystemPolicies } from './system-policies.js';
import { UpstreamError } from './upstream-error.js';

/** One call's outcome: the upstream's answer, or why there is none. */
export type CallOutcome<T> =
  { outcome: 'answered'; value: T } | { outcome: 'unavailable'; reason: UnavailableReason };

/** The upstream work of one call, made within the system's timeout. */
export type UpstreamWork<T> = (signal: AbortSignal, calls: UpstreamCalls) => Promise<T>;

export interface CallOptions {
  /**
   * Calls to the upstream the work usually makes (KRA's PINs, then one PIN's compliance); 1 when
   * unset. Their rate-limit slots are reserved together before the timeout starts.
   */
  calls?: number;
  /**
   * Identifiers of the call that may be logged when the system is unavailable (a subject hash,
   * an instruction reference): never a national ID, a name or a personal number.
   */
  log?: Record<string, unknown>;
}

/**
 * The resilience every call to a government system goes through, whatever it asks: a lookup
 * (`RegistryLookups`, which adds the answer cache and the verification-results row) or an
 * instruction (payroll), which is never cached. In order, against the system's policy
 * (`SYSTEM_POLICIES`): the pause flag, an open circuit failing fast, the system's rate limit, then
 * the work itself, timed out and behind the system's circuit breaker. Queueing for our own rate
 * limit never counts against the timeout or the breaker. The upstream not answering is an
 * outcome (`unavailable` with its reason), never an error; an unexpected error (a bug, not the
 * upstream) propagates.
 */
@Injectable()
export class ResilientCalls {
  private readonly logger = new Logger(ResilientCalls.name);

  constructor(
    private readonly pauses: PauseFlags,
    private readonly rateLimiter: RateLimiter,
    private readonly breakers: CircuitBreakers,
    @Inject(SYSTEM_POLICIES) private readonly policies: SystemPolicies,
  ) {}

  async call<T>(
    system: System,
    work: UpstreamWork<T>,
    options: CallOptions = {},
  ): Promise<CallOutcome<T>> {
    const policy = policyOf(this.policies, system);
    if (await this.pauses.isPaused(system)) return this.unavailable(system, 'paused', options);
    // An open circuit answers at once, before the call would queue for the rate limit.
    if (this.breakers.failsFast(system)) return this.unavailable(system, 'breaker-open', options);
    if (!(await this.rateLimiter.reserve(system, policy, options.calls ?? 1))) {
      return this.unavailable(system, 'rate-limited', options);
    }

    const calls: UpstreamCalls = {
      charge: (count) => this.rateLimiter.charge(system, policy, count),
    };
    try {
      const deadline = timeout(policy.timeoutMs, TimeoutStrategy.Aggressive);
      const value = await this.breakers
        .of(system)
        .execute(() => deadline.execute(({ signal }) => work(signal, calls)));
      return { outcome: 'answered', value };
    } catch (error) {
      return this.unavailable(system, unavailableReason(error), options);
    }
  }

  private unavailable(
    system: System,
    reason: UnavailableReason,
    { log }: CallOptions,
  ): CallOutcome<never> {
    const breaker = CircuitState[this.breakers.of(system).state];
    this.logger.warn({ system, ...log, reason, breaker }, 'System unavailable');
    return { outcome: 'unavailable', reason };
  }
}

function unavailableReason(error: unknown): UnavailableReason {
  if (error instanceof BrokenCircuitError) return 'breaker-open';
  if (error instanceof TaskCancelledError) return 'timeout';
  if (error instanceof UpstreamError) return error.reason;
  throw error;
}
