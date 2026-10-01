import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { ClarificationActivities } from '../clarifications/activities.js';
import { ClockModule } from '../clock.module.js';
import { config } from '../config.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProcessingActivities } from './activities.js';
import { DeclarationSubmittedConsumer } from './declaration-submitted.consumer.js';
import { ProcessingWorkflows } from './processing-workflows.js';

/**
 * The workflows module next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * Processing of submitted declarations (spec 07a): the `declaration.submitted.v1` consumer and the
 * review worker hosting `DeclarationProcessingWorkflow`, `ClarificationWorkflow` and their
 * activities.
 */
@Module({
  imports: [
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      // One worker per service: every workflow of the review service runs on this queue.
      activities: [ProcessingActivities, ClarificationActivities],
      imports: [
        ClockModule,
        DeclarationsModule,
        DirectoryModule,
        DocumentsModule,
        NotificationsModule,
      ],
    }),
  ],
  controllers: [DeclarationSubmittedConsumer],
  providers: [ProcessingWorkflows],
})
export class ProcessingModule {}
