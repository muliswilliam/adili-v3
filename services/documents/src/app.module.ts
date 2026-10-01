import { Module } from '@nestjs/common';
import {
  CoreModule,
  HttpReadinessCheck,
  IdempotencyModule,
  TcpReadinessCheck,
} from '@adili/api-kit';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import { TemporalModule, TemporalReadinessCheck } from '@adili/temporal';

import { AcknowledgementsModule } from './acknowledgements/acknowledgements.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { IssuanceModule } from './issuance/issuance.module.js';
import { S3ReadinessCheck, StorageModule } from './storage/storage.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

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
    IdempotencyModule.forRoot({
      database: DATABASE,
      // Outlasts the slowest idempotent request, completing an upload (its 60 s scan budget): a
      // retry sooner is told the first request is still running instead of scanning again.
      claimTimeoutMs: 2 * 60 * 1000,
    }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    StorageModule,
    UploadsModule,
    IssuanceModule,
    AcknowledgementsModule,
  ],
})
export class AppModule {}
