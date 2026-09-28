import { Module } from '@nestjs/common';
import { circuitBreaker, ConsecutiveBreaker, handleAll } from 'cockatiel';

import { config } from '../config.js';
import { SUBJECT_HASH_KEY, SubjectHasher } from '../verification/subject-hasher.js';
import { VerificationResults } from '../verification/verification-results.js';
import { IPRS_CACHE_TTL_SECONDS, IprsCache } from './iprs-cache.js';
import { IPRS_CLIENT_OPTIONS, IprsClient, type IprsClientOptions } from './iprs-client.js';
import { IPRS_BREAKER, IprsLookupService } from './iprs-lookup.service.js';
import { IprsController } from './iprs.controller.js';

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
      // Per process: each instance learns about an outage from its own failures (ADR-013).
      provide: IPRS_BREAKER,
      useFactory: () =>
        circuitBreaker(handleAll, {
          halfOpenAfter: config.BREAKER_COOLDOWN_MS,
          breaker: new ConsecutiveBreaker(config.BREAKER_FAILURE_THRESHOLD),
        }),
    },
  ],
})
export class IprsModule {}
