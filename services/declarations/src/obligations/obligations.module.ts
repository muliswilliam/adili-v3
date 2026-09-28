import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { ClockModule } from '../clock.js';
import { config } from '../config.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { CommissionObligationsService } from './commission-obligations.service.js';
import { ObligationsController } from './obligations.controller.js';
import { ObligationsService } from './obligations.service.js';
import { DirectoryEventsConsumer } from './directory-events.consumer.js';
import { RosterIngest } from './roster-ingest.js';
import { ObligationActivities } from './workflow/activities.js';
import { CycleOpeningActivities } from './workflow/cycle-opening-activities.js';
import {
  CycleOpeningSchedules,
  TemporalCycleOpeningSchedules,
} from './workflow/cycle-opening-schedules.js';
import { ObligationWorkflowsModule } from './workflow/obligation-workflows.module.js';
import { SweepSchedule } from './workflow/sweep.js';

/**
 * The workflows module: `workflows.ts` when running from source (dev server, tests),
 * `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(
    `./workflow/workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
    import.meta.url,
  ),
);

/**
 * Filing obligations (spec 04): derived from roster events by the obligation engine, read by
 * declarants and staff, and driven through their dates and reminders by one
 * `FilingObligationWorkflow` each on the declarations worker. Each biennial cycle is opened per
 * Commission by `CycleOpeningWorkflow`, fired by the Commission's schedule.
 */
@Module({
  imports: [
    DirectoryModule,
    ClockModule,
    ObligationWorkflowsModule,
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities: [ObligationActivities, CycleOpeningActivities],
      imports: [ObligationWorkflowsModule],
    }),
  ],
  controllers: [ObligationsController, DirectoryEventsConsumer],
  providers: [
    ObligationsService,
    CommissionObligationsService,
    RosterIngest,
    SweepSchedule,
    { provide: CycleOpeningSchedules, useClass: TemporalCycleOpeningSchedules },
  ],
})
export class ObligationsModule {}
