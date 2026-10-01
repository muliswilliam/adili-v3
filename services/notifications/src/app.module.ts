import { Module } from '@nestjs/common';
import { CoreModule, IdempotencyModule, TcpReadinessCheck } from '@adili/api-kit';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import { TemporalModule, TemporalReadinessCheck } from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { MessagesModule } from './messages/messages.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        // SMTP servers greet with 220 on connect.
        new TcpReadinessCheck('smtp', config.SMTP_HOST, config.SMTP_PORT, {
          send: '',
          expect: '220',
        }),
      ],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    // Sends take at most the 5 s budget, well inside the default claim timeout.
    IdempotencyModule.forRoot({ database: DATABASE }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    MessagesModule,
  ],
})
export class AppModule {}
