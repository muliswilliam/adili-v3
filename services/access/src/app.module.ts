import { Module } from '@nestjs/common';
import { CoreModule, IdempotencyModule } from '@adili/api-kit';
import {
  DATABASE,
  DatabaseModule,
  DatabaseReadinessCheck,
  OpenBaoReadinessCheck,
} from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import {
  TemporalModule,
  TemporalReadinessCheck,
  TemporalWorkerReadinessCheck,
} from '@adili/temporal';

import { OPENBAO } from './cipher.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { NoticesModule } from './notices/notices.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { AccessWorkerModule } from './worker.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        TemporalWorkerReadinessCheck,
        new OpenBaoReadinessCheck(OPENBAO),
      ],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    // Submitting requests and deciding them are safe to retry with the same `Idempotency-Key`
    // (ADR-009).
    IdempotencyModule.forRoot({ database: DATABASE }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    RequestsModule,
    NoticesModule,
    AccessWorkerModule,
  ],
})
export class AppModule {}
