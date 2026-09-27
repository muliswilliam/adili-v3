import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { config } from '../../config.js';
import { RosterImportActivities } from './activities.js';
import { ImportRowsJanitor } from './import-rows-purge.js';
import { RosterImportRowsService } from './import-rows.service.js';
import { RosterImportsController } from './imports.controller.js';
import { RosterImportsService } from './imports.service.js';
import { RosterUploadsModule } from './roster-uploads.module.js';

/**
 * The workflows module next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * Roster imports (spec #27): the start, preview and read endpoints (history, rows, rejected rows
 * report) with the 30-day purge of rows, and the directory's Temporal
 * worker hosting `RosterImportWorkflow` and its activities.
 */
@Module({
  imports: [
    RosterUploadsModule,
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities: [RosterImportActivities],
      imports: [RosterUploadsModule],
    }),
  ],
  controllers: [RosterImportsController],
  providers: [RosterImportsService, RosterImportRowsService, ImportRowsJanitor],
})
export class RosterImportModule {}
