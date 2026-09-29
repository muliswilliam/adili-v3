import { Module } from '@nestjs/common';
import { CoreModule, IdempotencyModule } from '@adili/api-kit';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import {
  TemporalModule,
  TemporalReadinessCheck,
  TemporalWorkerReadinessCheck,
} from '@adili/temporal';

import { ApprovalsModule } from './approvals/approvals.module.js';
import { CasesModule } from './cases/cases.module.js';
import { ClarificationsModule } from './clarifications/clarifications.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { DeterminationsModule } from './determinations/determinations.module.js';
import { ProcessingModule } from './processing/processing.module.js';

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
    CasesModule,
    ClarificationsModule,
    DeterminationsModule,
    ApprovalsModule,
    ProcessingModule,
  ],
})
export class AppModule {}
