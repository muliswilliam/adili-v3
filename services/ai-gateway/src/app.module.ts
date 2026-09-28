import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { CoreModule } from '@adili/api-kit';
import { DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import {
  TemporalModule,
  TemporalReadinessCheck,
  TemporalWorkerModule,
  TemporalWorkerReadinessCheck,
} from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { JobActivities } from './jobs/job-activities.js';
import { JobsModule } from './jobs/jobs.module.js';

/** The workflow module next to the job activities: `.ts` under the dev loader, `.js` built. */
const workflowsPath = fileURLToPath(
  new URL(`./jobs/workflows${extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);

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
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.AI_TASK_QUEUE,
      workflowsPath,
      imports: [JobsModule],
      activities: [JobActivities],
    }),
    JobsModule,
  ],
})
export class AppModule {}
