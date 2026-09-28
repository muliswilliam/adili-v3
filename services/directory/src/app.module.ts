import { Module } from '@nestjs/common';
import { CoreModule, IdempotencyModule, RateLimitModule } from '@adili/api-kit';
import { CacheModule, ValkeyRateLimitStore, ValkeyReadinessCheck } from '@adili/cache';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import {
  TemporalModule,
  TemporalReadinessCheck,
  TemporalWorkerReadinessCheck,
} from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { CommissionsModule } from './commissions/commissions.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { MeController } from './me/me.controller.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { PersonsModule } from './persons/persons.module.js';
import { ApiCredentialModule } from './roster/api-credential/api-credential.module.js';
import { RosterExitsModule } from './roster/exits/exits.module.js';
import { RosterImportModule } from './roster/import/import.module.js';
import { RosterRecordsModule } from './roster/records/records.module.js';
import { RosterModule } from './roster/roster.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        ValkeyReadinessCheck,
        TemporalReadinessCheck,
        TemporalWorkerReadinessCheck,
      ],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    IdempotencyModule.forRoot({
      database: DATABASE,
      // Outlasts the slowest idempotent request: an assignment whose dozen or so Keycloak admin
      // calls each take their full 5 s timeout, then the 25 s activation email. A retry sooner
      // is told the first request is still running instead of running it again.
      claimTimeoutMs: 3 * 60 * 1000,
    }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    RateLimitModule.forRoot({ policies: config.RATE_LIMITS, store: ValkeyRateLimitStore }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    IdentityModule,
    CommissionsModule,
    RosterModule,
    ApiCredentialModule,
    RosterImportModule,
    RosterRecordsModule,
    RosterExitsModule,
    OnboardingModule,
    PersonsModule,
  ],
  controllers: [MeController],
})
export class AppModule {}
