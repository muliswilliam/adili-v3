import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { v7 as uuidv7 } from 'uuid';

import type { UnavailableReason } from '../db/schema.js';
import { SubjectHasher } from '../verification/subject-hasher.js';
import { VerificationResults } from '../verification/verification-results.js';
import { type Answer, AnswerCache } from './answer-cache.js';
import type {
  KeyedRegistryAdapter,
  LookupContext,
  LookupResult,
  RegistryAdapter,
} from './registry-adapter.js';
import { ResilientCalls } from './resilient-calls.js';
import { policyOf, SYSTEM_POLICIES, type SystemPolicies } from './system-policies.js';

/** A lookup's outcome before it is recorded. */
type Resolved<T> =
  | { outcome: 'found'; data: T; cached: boolean }
  | { outcome: 'not-found'; cached: boolean }
  | { outcome: 'unavailable'; reason: UnavailableReason };

/**
 * The adapter kit's lookups: every registry lookup goes through `lookup`, whatever the registry.
 * The pause flag first (a paused system answers `unavailable`, cached answers included), then the
 * 24-hour cache of answers (found and not found), then the adapter's call through `ResilientCalls`
 * (rate limit, timeout and circuit breaker). Every call to the
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
    private readonly calls: ResilientCalls,
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
    const { cacheTtlSeconds } = policyOf(this.policies, system);
    // A paused system answers nothing, not even from the cache: the outage shows (spec 07b S13:
    // pause, then the rate limit, then the cache). The cache is kept for when it resumes.
    const paused = await this.calls.whilePaused(system, { log: { subjectHash } });
    if (paused) return paused;
    // A system without a cache lifetime answers every lookup afresh.
    const hit = cacheTtlSeconds === null ? undefined : await this.cache.get(adapter, subjectHash);
    if (hit) return fromAnswer(hit, true);

    // Subject hash only: logs never carry national IDs or names.
    const call = await this.calls.call(
      system,
      (signal, calls) => adapter.fetch(subject, signal, calls),
      { calls: adapter.callsPerLookup ?? 1, log: { subjectHash } },
    );
    if (call.outcome === 'unavailable') return call;
    const answer: Answer<T> =
      call.value === null ? { found: false } : { found: true, data: call.value };
    if (cacheTtlSeconds !== null) {
      await this.cache.set(adapter, subjectHash, answer, cacheTtlSeconds);
    }
    return fromAnswer(answer, false);
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
