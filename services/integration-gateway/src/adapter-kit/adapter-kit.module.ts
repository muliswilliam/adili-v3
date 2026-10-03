import { type DynamicModule, Module } from '@nestjs/common';
import { FieldCipher, OpenBaoTransitCipher } from '@adili/data-access';

import { SUBJECT_HASH_KEY, SubjectHasher } from '../verification/subject-hasher.js';
import { VerificationResults } from '../verification/verification-results.js';
import { AnswerCache } from './answer-cache.js';
import { BREAKER_OPTIONS, type BreakerOptions, CircuitBreakers } from './circuit-breakers.js';
import { PauseFlags } from './pause-flags.js';
import { RateLimiter } from './rate-limiter.js';
import { RegistryLookups } from './registry-lookups.js';
import { ResilientCalls } from './resilient-calls.js';
import { SystemCallLog } from './system-call-log.js';
import { SYSTEM_POLICIES, type SystemPolicies } from './system-policies.js';

export interface AdapterKitOptions {
  /** Every system's policy; a system without one has no adapter. */
  policies: SystemPolicies;
  breaker: BreakerOptions;
  /** HMAC key of subject hashes (verification results, cache keys). */
  subjectHashKey: string;
  /** OpenBao Transit, whose tenant keys encrypt stored lookup answers (ADR-006). */
  openbao: { url: string; token: string };
}

/**
 * The adapter kit every adapter is built on, with the per-system state it keeps (circuit
 * breakers, pause flags and rate limits): `ResilientCalls` for any call to a system, and
 * `RegistryLookups` for lookups (cache and verification results on top). Global, configured once
 * by the app with every system's policy.
 */
@Module({})
export class AdapterKitModule {
  static forRoot(options: AdapterKitOptions): DynamicModule {
    return {
      module: AdapterKitModule,
      global: true,
      providers: [
        ResilientCalls,
        SystemCallLog,
        RegistryLookups,
        AnswerCache,
        PauseFlags,
        RateLimiter,
        CircuitBreakers,
        SubjectHasher,
        VerificationResults,
        { provide: FieldCipher, useFactory: () => new OpenBaoTransitCipher(options.openbao) },
        { provide: SUBJECT_HASH_KEY, useValue: options.subjectHashKey },
        { provide: BREAKER_OPTIONS, useValue: options.breaker },
        { provide: SYSTEM_POLICIES, useValue: options.policies },
      ],
      exports: [
        ResilientCalls,
        SystemCallLog,
        RegistryLookups,
        PauseFlags,
        CircuitBreakers,
        SubjectHasher,
        VerificationResults,
        FieldCipher,
        SYSTEM_POLICIES,
        BREAKER_OPTIONS,
      ],
    };
  }
}
