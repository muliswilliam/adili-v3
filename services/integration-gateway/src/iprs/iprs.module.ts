import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { CLOCK, type Clock } from '../resilience/clock.js';
import { VerificationResults } from '../verification/verification-results.js';
import { IPRS_CACHE_TTL_SECONDS, IprsCache } from './iprs-cache.js';
import { IPRS_CLIENT_OPTIONS, IprsClient, type IprsClientOptions } from './iprs-client.js';
import { IPRS_BREAKER, IprsLookupService } from './iprs-lookup.service.js';
import { IprsController } from './iprs.controller.js';
import { SUBJECT_HASH_KEY, SubjectHasher } from './subject-hasher.js';

/** IPRS identity lookup for onboarding (`/internal/v1/iprs`). */
@Module({
  controllers: [IprsController],
  providers: [
    IprsLookupService,
    IprsClient,
    IprsCache,
    SubjectHasher,
    VerificationResults,
    {
      provide: IPRS_CLIENT_OPTIONS,
      useValue: {
        baseUrl: config.IPRS_BASE_URL,
        timeoutMs: config.IPRS_TIMEOUT_MS,
      } satisfies IprsClientOptions,
    },
    { provide: IPRS_CACHE_TTL_SECONDS, useValue: config.IPRS_CACHE_TTL_SECONDS },
    { provide: SUBJECT_HASH_KEY, useValue: config.SUBJECT_HASH_KEY },
    {
      provide: IPRS_BREAKER,
      inject: [CLOCK],
      useFactory: (clock: Clock) =>
        new CircuitBreaker(
          {
            failureThreshold: config.BREAKER_FAILURE_THRESHOLD,
            cooldownMs: config.BREAKER_COOLDOWN_MS,
          },
          clock,
        ),
    },
  ],
})
export class IprsModule {}
