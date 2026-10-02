import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { CipherModule } from './cipher.module.js';
import { ClockModule } from './clock.module.js';
import { config } from './config.js';
import { LeaRequestActivities } from './lea/activities.js';
import { OnboardedNoticeActivities } from './onboarded-notices/activities.js';
import { RegisterModule } from './register/access-register.js';
import { AccessRequestActivities } from './requests/activities.js';
import { DecisionActivities } from './requests/decision-activities.js';
import { CertifiedCopyActivities } from './self-access/activities.js';
import { UpstreamModule } from './upstream.module.js';

/**
 * The workflows entry next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * The access worker (ADR-003), one per service: every workflow of the access service runs on its
 * queue, with its activities listed here as their modules add them (`AccessRequestWorkflow`,
 * `LeaRequestWorkflow`, `CertifiedCopyWorkflow`, `OnboardedNoticeWorkflow`). Activities get the clock, the cipher, the
 * upstream clients and the access register.
 */
@Module({
  imports: [
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities: [
        AccessRequestActivities,
        DecisionActivities,
        CertifiedCopyActivities,
        LeaRequestActivities,
        OnboardedNoticeActivities,
      ],
      imports: [ClockModule, CipherModule, UpstreamModule, RegisterModule],
    }),
  ],
})
export class AccessWorkerModule {}
