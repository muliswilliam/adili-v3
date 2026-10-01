import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { config } from './config.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { OnboardingExpiryActivities } from './onboarding/sessions/expiry-activities.js';
import { RosterImportActivities } from './roster/import/activities.js';
import { RosterUploadsModule } from './roster/import/roster-uploads.module.js';

/**
 * `workflows.ts` next to this file when running from source (dev server, tests), `workflows.js`
 * in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * The directory's Temporal worker (ADR-003, ADR-013 §4) on its task queue: roster imports
 * (`rosterImport`, spec #27) and the onboarding session expiry sweep (`onboardingSessionExpiry`,
 * spec 03), with their activities.
 */
@Module({
  imports: [
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities: [RosterImportActivities, OnboardingExpiryActivities],
      imports: [RosterUploadsModule, OnboardingModule],
    }),
  ],
})
export class DirectoryWorkerModule {}
