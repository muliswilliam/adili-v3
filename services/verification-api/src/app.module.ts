import { Module } from '@nestjs/common';
import { CoreModule, RateLimitModule } from '@adili/api-kit';
import { CacheModule, ValkeyRateLimitStore, ValkeyReadinessCheck } from '@adili/cache';
import { DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { VerificationModule } from './verification/verification.module.js';

/**
 * The isolated verification API (ADR-010 §5): its own projection, fed by events, and no client
 * of any other service.
 */
@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [DatabaseReadinessCheck, RabbitMqReadinessCheck, ValkeyReadinessCheck],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    RateLimitModule.forRoot({ policies: config.RATE_LIMITS, store: ValkeyRateLimitStore }),
    VerificationModule,
  ],
})
export class AppModule {}
