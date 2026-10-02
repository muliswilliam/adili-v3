import { Module } from '@nestjs/common';
import { CoreModule, HttpReadinessCheck, IdempotencyModule } from '@adili/api-kit';
import { CacheModule } from '@adili/cache';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import { TemporalModule, TemporalReadinessCheck } from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { IprsModule } from './iprs/iprs.module.js';
import { RegistriesModule } from './registries/registries.module.js';
import { VerificationModule } from './verification/verification.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        // Not Valkey: lookups skip the cache while it is down, so it is no reason to go unready.
        new HttpReadinessCheck('government-systems', `${config.MOCKS_BASE_URL}/health`),
      ],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    IdempotencyModule.forRoot({ database: DATABASE }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    IprsModule,
    RegistriesModule,
    VerificationModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
