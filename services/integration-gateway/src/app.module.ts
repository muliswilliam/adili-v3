import { Module } from '@nestjs/common';
import { CoreModule, HttpReadinessCheck } from '@adili/api-kit';
import { CacheModule, ValkeyReadinessCheck } from '@adili/cache';
import { DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import { TemporalModule, TemporalReadinessCheck } from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { IprsModule } from './iprs/iprs.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        ValkeyReadinessCheck,
        new HttpReadinessCheck('government-systems', `${config.MOCKS_BASE_URL}/health`),
      ],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    IprsModule,
  ],
})
export class AppModule {}
