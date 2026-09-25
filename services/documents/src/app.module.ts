import { Module } from '@nestjs/common';
import { CoreModule, HttpReadinessCheck, TcpReadinessCheck } from '@adili/api-kit';
import { DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import { TemporalModule, TemporalReadinessCheck } from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { S3ReadinessCheck, StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        S3ReadinessCheck,
        // clamd answers PONG to the zero-terminated PING command.
        new TcpReadinessCheck('clamav', config.CLAMAV_HOST, config.CLAMAV_PORT, {
          send: 'zPING\0',
          expect: 'PONG',
        }),
        new HttpReadinessCheck('gotenberg', `${config.GOTENBERG_URL}/health`),
        new HttpReadinessCheck('openbao', `${config.OPENBAO_ADDR}/v1/sys/health`),
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
    StorageModule,
  ],
})
export class AppModule {}
