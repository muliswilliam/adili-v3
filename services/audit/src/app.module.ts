import { Module } from '@nestjs/common';
import { CoreModule } from '@adili/api-kit';
import { DatabaseModule, DatabaseReadinessCheck, OpenBaoReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import {
  TemporalModule,
  TemporalReadinessCheck,
  TemporalWorkerReadinessCheck,
} from '@adili/temporal';

import {
  AnchorArchiveReadinessCheck,
  AnchoringModule,
  OPENBAO,
} from './anchoring/anchoring.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { TrailModule } from './trail/trail.module.js';
import { AuditWorkerModule } from './worker.module.js';

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
        AnchorArchiveReadinessCheck,
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
    TrailModule,
    AnchoringModule,
    AuditWorkerModule,
  ],
})
export class AppModule {}
