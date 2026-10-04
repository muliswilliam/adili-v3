import { Module } from '@nestjs/common';

import { config } from '../config.js';
import {
  DOCUMENT_FETCHER_OPTIONS,
  DocumentFetcher,
  type DocumentFetcherOptions,
} from '../documents/document-fetcher.js';
import { PolicyModule } from '../policy/policy.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { Admission } from './admission.js';
import { JobExecutor } from './job-executor.js';
import { JOB_WORKFLOWS_OPTIONS, JobWorkflows, type JobWorkflowsOptions } from './job-workflows.js';
import { JobsController } from './jobs.controller.js';
import { JANITOR_OPTIONS, type JanitorOptions, JobsJanitor } from './jobs-janitor.js';
import { JobsService } from './jobs.service.js';
import { AnswerStreams } from './answer-streams.js';
import { Routing, ROUTING_OPTIONS, type RoutingOptions } from './routing.js';

/** Margin over the provider timeout for building the request and recording the outcome. */
const ATTEMPT_OVERHEAD_MS = 30_000;

/** Task jobs: the internal task and job API, routing, execution and the janitor. */
@Module({
  imports: [ProvidersModule.forRoot(config), PolicyModule],
  controllers: [JobsController],
  providers: [
    JobsService,
    AnswerStreams,
    Admission,
    JobExecutor,
    JobWorkflows,
    JobsJanitor,
    Routing,
    DocumentFetcher,
    {
      provide: DOCUMENT_FETCHER_OPTIONS,
      useValue: {
        allowedOrigins: config.AI_DOCUMENT_ORIGINS,
        maxBytes: config.AI_DOCUMENT_MAX_BYTES,
        timeoutMs: config.AI_DOCUMENT_TIMEOUT_MS,
      } satisfies DocumentFetcherOptions,
    },
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
      useValue: { outputRetentionHours: config.AI_OUTPUT_RETENTION_HOURS } satisfies JanitorOptions,
    },
  ],
  exports: [JobExecutor, Routing, PolicyModule, ProvidersModule],
})
export class JobsModule {}
