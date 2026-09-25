import { Module } from '@nestjs/common';
import { CoreModule } from '@adili/api-kit';
import { DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [DatabaseReadinessCheck, RabbitMqReadinessCheck],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
  ],
})
export class AppModule {}
