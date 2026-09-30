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
import { ComplianceReportsModule } from './compliance-reports/compliance-reports.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { NationalReportsModule } from './national-reports/national-reports.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { ReferralsModule } from './referrals/referrals.module.js';
import { ReportingWorkerModule } from './worker.module.js';

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
    // Confirming and submitting a report are safe to retry with the same `Idempotency-Key` (ADR-009).
    IdempotencyModule.forRoot({ database: DATABASE }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    ProjectionsModule,
    ComplianceReportsModule,
    NationalReportsModule,
    ReferralsModule,
    ReportingWorkerModule,
  ],
})
export class AppModule {}
