import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { AnchoringActivities } from './anchoring/activities.js';
import { config } from './config.js';

/**
 * The workflows entry next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * The audit worker (ADR-003), one per service: the daily anchoring (`auditAnchoring`) and its
 * activities run on its queue.
 */
@Module({
  imports: [
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities: [AnchoringActivities],
    }),
  ],
})
export class AuditWorkerModule {}
