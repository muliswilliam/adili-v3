import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { JobExecutor } from './job-executor.js';
import { JOB_WORKFLOWS_OPTIONS, JobWorkflows, type JobWorkflowsOptions } from './job-workflows.js';
import { JobsController } from './jobs.controller.js';
import { JANITOR_OPTIONS, type JanitorOptions, JobsJanitor } from './jobs-janitor.js';
import { JobsService } from './jobs.service.js';
import { Routing, ROUTING_OPTIONS, type RoutingOptions } from './routing.js';

/** Margin over the provider timeout for building the request and recording the outcome. */
const ATTEMPT_OVERHEAD_MS = 30_000;

/** Task jobs: the internal task and job API, execution and the janitor. */
@Module({
  imports: [ProvidersModule.forRoot(config)],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobExecutor,
    JobWorkflows,
    JobsJanitor,
    Routing,
    { provide: ROUTING_OPTIONS, useValue: { model: config.AI_MODEL } satisfies RoutingOptions },
    {
      provide: JOB_WORKFLOWS_OPTIONS,
      useValue: {
        taskQueue: config.AI_TASK_QUEUE,
        attemptTimeoutMs: config.AI_PROVIDER_TIMEOUT_MS + ATTEMPT_OVERHEAD_MS,
      } satisfies JobWorkflowsOptions,
    },
    {
      provide: JANITOR_OPTIONS,
      useValue: { outputRetentionDays: config.AI_OUTPUT_RETENTION_DAYS } satisfies JanitorOptions,
    },
  ],
  exports: [JobExecutor],
})
export class JobsModule {}
