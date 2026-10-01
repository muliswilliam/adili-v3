import { Module } from '@nestjs/common';
import { FieldCipher, OpenBaoTransitCipher } from '@adili/data-access';

import { config } from '../config.js';
import { SUBJECT_HASH_KEY, SubjectHasher } from '../verification/subject-hasher.js';
import { VerificationResults } from '../verification/verification-results.js';
import { AnswerCache } from './answer-cache.js';
import { BREAKER_OPTIONS, type BreakerOptions, CircuitBreakers } from './circuit-breakers.js';
import { PauseFlags } from './pause-flags.js';
import { RateLimiter } from './rate-limiter.js';
import { RegistryLookups } from './registry-lookups.js';
import { SYSTEM_POLICIES, type SystemPolicies } from './system-policies.js';

/** OpenBao Transit connection of the service (ADR-006 tenant keys). */
export const OPENBAO = { url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN };

/**
 * The adapter kit every registry adapter is built on (`RegistryLookups`), with the per-system
 * state it keeps: circuit breakers, pause flags and rate limits.
 */
@Module({
  providers: [
    RegistryLookups,
    AnswerCache,
    PauseFlags,
    RateLimiter,
    CircuitBreakers,
    SubjectHasher,
    VerificationResults,
    { provide: FieldCipher, useFactory: () => new OpenBaoTransitCipher(OPENBAO) },
    { provide: SUBJECT_HASH_KEY, useValue: config.SUBJECT_HASH_KEY },
    {
      provide: BREAKER_OPTIONS,
      useValue: {
        failureThreshold: config.BREAKER_FAILURE_THRESHOLD,
        cooldownMs: config.BREAKER_COOLDOWN_MS,
      } satisfies BreakerOptions,
    },
    {
      provide: SYSTEM_POLICIES,
      useValue: {
        iprs: {
          timeoutMs: config.IPRS_TIMEOUT_MS,
          cacheTtlSeconds: config.IPRS_CACHE_TTL_SECONDS,
          ratePerMinute: config.IPRS_RATE_LIMIT_PER_MINUTE,
          maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
        },
        kra: {
          timeoutMs: config.KRA_TIMEOUT_MS,
          cacheTtlSeconds: config.KRA_CACHE_TTL_SECONDS,
          ratePerMinute: config.KRA_RATE_LIMIT_PER_MINUTE,
          maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
        },
        ntsa: {
          timeoutMs: config.NTSA_TIMEOUT_MS,
          cacheTtlSeconds: config.NTSA_CACHE_TTL_SECONDS,
          ratePerMinute: config.NTSA_RATE_LIMIT_PER_MINUTE,
          maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
        },
        brs: {
          timeoutMs: config.BRS_TIMEOUT_MS,
          cacheTtlSeconds: config.BRS_CACHE_TTL_SECONDS,
          ratePerMinute: config.BRS_RATE_LIMIT_PER_MINUTE,
          maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
        },
        ardhisasa: {
          timeoutMs: config.ARDHISASA_TIMEOUT_MS,
          cacheTtlSeconds: config.ARDHISASA_CACHE_TTL_SECONDS,
          ratePerMinute: config.ARDHISASA_RATE_LIMIT_PER_MINUTE,
          maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
        },
      } satisfies SystemPolicies,
    },
  ],
  exports: [
    RegistryLookups,
    PauseFlags,
    CircuitBreakers,
    VerificationResults,
    FieldCipher,
    SYSTEM_POLICIES,
    BREAKER_OPTIONS,
  ],
})
export class AdapterKitModule {}
