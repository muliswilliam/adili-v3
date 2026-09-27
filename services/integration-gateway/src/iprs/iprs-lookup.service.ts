import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
import { BrokenCircuitError, CircuitState, type CircuitBreakerPolicy } from 'cockatiel';

import type { UnavailableReason } from '../db/schema.js';
import { UpstreamError } from '../resilience/upstream-error.js';
import { VerificationResults } from '../verification/verification-results.js';
import { type IprsAnswer, IprsCache } from './iprs-cache.js';
import { IprsClient } from './iprs-client.js';
import type { IprsPerson } from './iprs-person.js';
import { SubjectHasher } from './subject-hasher.js';

export const IPRS_BREAKER = Symbol('IPRS_BREAKER');

/** What a lookup produced: IPRS's answer (fresh or cached), or why there is none. */
export type IprsLookup =
  | { outcome: 'found'; person: IprsPerson; cached: boolean }
  | { outcome: 'not-found'; cached: boolean }
  | { outcome: 'unavailable'; reason: UnavailableReason };

/**
 * Looks a person up in IPRS by national ID. Answers (found and not found) are reused for the
 * cache TTL; registry calls go through the IPRS circuit breaker, so an outage costs callers a
 * fast `unavailable` instead of a timeout each.
 */
@Injectable()
export class IprsLookupService {
  private readonly logger = new Logger(IprsLookupService.name);

  constructor(
    private readonly client: IprsClient,
    private readonly cache: IprsCache,
    private readonly hasher: SubjectHasher,
    @Inject(IPRS_BREAKER) private readonly breaker: CircuitBreakerPolicy,
    private readonly results: VerificationResults,
  ) {}

  /** Every lookup, answered or not, leaves a verification-results row. */
  async lookup(nationalId: string, caller: Principal): Promise<IprsLookup> {
    const started = performance.now();
    const subjectHash = this.hasher.hash('iprs', nationalId);
    const result = await this.resolve(nationalId, subjectHash);
    await this.results.record(
      {
        system: 'iprs',
        subjectHash,
        outcome: result.outcome,
        reason: result.outcome === 'unavailable' ? result.reason : null,
        cached: result.outcome !== 'unavailable' && result.cached,
        latencyMs: performance.now() - started,
      },
      caller,
    );
    return result;
  }

  private async resolve(nationalId: string, subjectHash: string): Promise<IprsLookup> {
    const hit = await this.cache.get(subjectHash);
    if (hit) return fromAnswer(hit, true);

    let answer: IprsAnswer;
    try {
      const person = await this.breaker.execute(() => this.client.getPerson(nationalId));
      answer = person ? { found: true, person } : { found: false };
    } catch (error) {
      const reason = unavailableReason(error);
      // Subject hash only: logs never carry national IDs or names.
      this.logger.warn(
        { subjectHash, reason, breaker: CircuitState[this.breaker.state] },
        'IPRS unavailable',
      );
      return { outcome: 'unavailable', reason };
    }
    await this.cache.set(subjectHash, answer);
    return fromAnswer(answer, false);
  }
}

function fromAnswer(answer: IprsAnswer, cached: boolean): IprsLookup {
  return answer.found
    ? { outcome: 'found', person: answer.person, cached }
    : { outcome: 'not-found', cached };
}

function unavailableReason(error: unknown): UnavailableReason {
  if (error instanceof BrokenCircuitError) return 'breaker-open';
  if (error instanceof UpstreamError) return error.reason;
  throw error;
}
