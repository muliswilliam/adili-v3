import { Module } from '@nestjs/common';
import { CoreModule, IdempotencyModule } from '@adili/api-kit';
import { CacheModule, ValkeyReadinessCheck } from '@adili/cache';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { IdentityModule } from './identity/identity.module.js';
import { MeController } from './me/me.controller.js';

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
    IdempotencyModule.forRoot({ database: DATABASE }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    IdentityModule,
  ],
  controllers: [MeController],
})
export class AppModule {}
