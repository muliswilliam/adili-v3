import { Module } from '@nestjs/common';

import { ImportRowsJanitor } from './import-rows-purge.js';
import { RosterImportRowsService } from './import-rows.service.js';
import { RosterImportsController } from './imports.controller.js';
import { RosterImportsService } from './imports.service.js';
import { RosterUploadsModule } from './roster-uploads.module.js';

/**
 * Roster imports (spec #27): the start, preview and read endpoints (history, rows, rejected rows
 * report) with the 30-day purge of rows. `rosterImport` and its activities run on the directory's
 * worker (`worker.module.ts`).
 */
@Module({
  imports: [RosterUploadsModule],
  controllers: [RosterImportsController],
  providers: [RosterImportsService, RosterImportRowsService, ImportRowsJanitor],
})
export class RosterImportModule {}
