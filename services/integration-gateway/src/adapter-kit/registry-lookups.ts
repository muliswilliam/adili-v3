import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import {
  BrokenCircuitError,
  CircuitState,
  TaskCancelledError,
  timeout,
  TimeoutStrategy,
} from 'cockatiel';
import { v7 as uuidv7 } from 'uuid';

import type { UnavailableReason } from '../db/schema.js';
import { SubjectHasher } from '../verification/subject-hasher.js';
import { VerificationResults } from '../verification/verification-results.js';
import { type Answer, AnswerCache } from './answer-cache.js';
import { CircuitBreakers } from './circuit-breakers.js';
import { PauseFlags } from './pause-flags.js';
import { RateLimiter } from './rate-limiter.js';
import type {
  KeyedRegistryAdapter,
  LookupContext,
  LookupResult,
  RegistryAdapter,
  UpstreamCalls,
} from './registry-adapter.js';
import { policyOf, SYSTEM_POLICIES, type SystemPolicies } from './system-policies.js';
import { UpstreamError } from './upstream-error.js';

/** A lookup's outcome before it is recorded. */
type Resolved<T> =
  | { outcome: 'found'; data: T; cached: boolean }
  | { outcome: 'not-found'; cached: boolean }
  | { outcome: 'unavailable'; reason: UnavailableReason };

/**
 * The adapter kit: every registry lookup goes through `lookup`, whatever the registry. In order:
 * the 24-hour cache of answers (found and not found), the pause flag, the system's rate limit,
 * then the adapter's call, timed out and behind the system's circuit breaker. Every call to the
 * registry takes a rate-limit slot: the kit reserves the adapter's usual calls together before
 * the timeout starts, and the adapter charges any more (KRA's second PIN) without waiting, so
 * queueing for our own limit never counts against the timeout or the breaker. Every lookup,
 * answered or not, leaves a verification-results row and a `registry.lookup.performed.v1`.
 */
@Injectable()
export class RegistryLookups {
  private readonly logger = new Logger(RegistryLookups.name);

  constructor(
    private readonly cache: AnswerCache,
    private readonly pauses: PauseFlags,
    private readonly rateLimiter: RateLimiter,
    private readonly breakers: CircuitBreakers,
    private readonly hasher: SubjectHasher,
    private readonly results: VerificationResults,
    @Inject(SYSTEM_POLICIES) private readonly policies: SystemPolicies,
  ) {}

  /**
   * Looks `subject` (e.g. a national ID) up through `adapter`. The answer does not wait on its
   * record: when the row cannot be written, `resultId` is null and the route decides (IPRS at
   * onboarding answers anyway; the registry routes refuse with 503 `lookup-not-recorded`, as a
   * lookup for a case must be audited). An unexpected error is recorded as unavailable before it
   * propagates.
   */
  async lookup<T>(
    adapter: RegistryAdapter<T>,
    subject: string,
    context: LookupContext,
  ): Promise<LookupResult<T>>;
  async lookup<T, S>(
    adapter: KeyedRegistryAdapter<T, S>,
    subject: S,
    context: LookupContext,
  ): Promise<LookupResult<T>>;
  async lookup<T, S>(
    adapter: RegistryAdapter<T, S> & Partial<Pick<KeyedRegistryAdapter<T, S>, 'subjectKey'>>,
    subject: S,
    context: LookupContext,
  ): Promise<LookupResult<T>> {
    const started = performance.now();
    const key = adapter.subjectKey ? adapter.subjectKey(subject) : String(subject);
    const subjectHash = this.hasher.hash(adapter.system, key);
    let resolved: Resolved<T>;
    try {
      resolved = await this.resolve(adapter, subject, subjectHash);
    } catch (error) {
      await this.record(
        adapter,
        subjectHash,
        { outcome: 'unavailable', reason: 'upstream-error' },
        started,
        context,
      );
      throw error;
    }
    const resultId = await this.record(adapter, subjectHash, resolved, started, context);
    return { ...resolved, resultId, checkedAt: new Date() };
  }

  private async resolve<T, S>(
    adapter: RegistryAdapter<T, S>,
    subject: S,
    subjectHash: string,
  ): Promise<Resolved<T>> {
    const { system } = adapter;
    const policy = policyOf(this.policies, system);
    const hit = await this.cache.get(adapter, subjectHash);
    if (hit) return fromAnswer(hit, true);

    if (await this.pauses.isPaused(system)) return this.unavailable(adapter, subjectHash, 'paused');
    // An open circuit answers at once, before the call would queue for the rate limit.
    if (this.breakers.failsFast(system)) {
      return this.unavailable(adapter, subjectHash, 'breaker-open');
    }
    if (!(await this.rateLimiter.reserve(system, policy, adapter.callsPerLookup ?? 1))) {
      return this.unavailable(adapter, subjectHash, 'rate-limited');
    }

    const calls: UpstreamCalls = {
      charge: (count) => this.rateLimiter.charge(system, policy, count),
    };
    let answer: Answer<T>;
    try {
      const deadline = timeout(policy.timeoutMs, TimeoutStrategy.Aggressive);
      const data = await this.breakers
        .of(system)
        .execute(() => deadline.execute(({ signal }) => adapter.fetch(subject, signal, calls)));
      answer = data === null ? { found: false } : { found: true, data };
    } catch (error) {
      return this.unavailable(adapter, subjectHash, unavailableReason(error));
    }
    await this.cache.set(adapter, subjectHash, answer, policy.cacheTtlSeconds);
    return fromAnswer(answer, false);
  }

  private unavailable(
    adapter: Pick<RegistryAdapter<unknown>, 'system'>,
    subjectHash: string,
    reason: UnavailableReason,
  ): Resolved<never> {
    const breaker = CircuitState[this.breakers.of(adapter.system).state];
    // Subject hash only: logs never carry national IDs or names.
    this.logger.warn(
      { system: adapter.system, subjectHash, reason, breaker },
      'Registry unavailable',
    );
    return { outcome: 'unavailable', reason };
  }

  private async record<T>(
    adapter: Pick<RegistryAdapter<T>, 'system'>,
    subjectHash: string,
    resolved: Resolved<T>,
    started: number,
    { caller, purpose, tenant }: LookupContext,
  ): Promise<string | null> {
    const id = uuidv7();
    try {
      await this.results.record({
        id,
        system: adapter.system,
        subjectHash,
        outcome: resolved.outcome,
        reason: resolved.outcome === 'unavailable' ? resolved.reason : null,
        cached: resolved.outcome !== 'unavailable' && resolved.cached,
        latencyMs: performance.now() - started,
        caller,
        legalBasis: purpose.legalBasis,
        caseRef: purpose.caseRef,
        subjectPersonId: purpose.subjectPersonId,
        tenant,
        payload: resolved.outcome === 'found' ? resolved.data : undefined,
      });
      return id;
    } catch (error) {
      // The caller still gets its answer: onboarding must not stop because the log could not be
      // written. The error is logged (without the subject) so the gap shows.
      this.logger.error(
        { system: adapter.system, subjectHash, errorType: errorType(error) },
        'Verification result not recorded',
      );
      return null;
    }
  }
}

function fromAnswer<T>(answer: Answer<T>, cached: boolean): Resolved<T> {
  return answer.found
    ? { outcome: 'found', data: answer.data, cached }
    : { outcome: 'not-found', cached };
}

function unavailableReason(error: unknown): UnavailableReason {
  if (error instanceof BrokenCircuitError) return 'breaker-open';
  if (error instanceof TaskCancelledError) return 'timeout';
  if (error instanceof UpstreamError) return error.reason;
  throw error;
}
