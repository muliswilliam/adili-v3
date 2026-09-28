import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../clock.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { CommissionObligationsService } from './commission-obligations.service.js';
import { ObligationsController } from './obligations.controller.js';
import { ObligationsService } from './obligations.service.js';
import { RosterEventsConsumer } from './roster-events.consumer.js';
import { RosterIngest } from './roster-ingest.js';
import { DeferredObligationWorkflows, ObligationWorkflows } from './workflows.js';

/**
 * Filing obligations (spec 04): derived from roster events by the obligation engine, read by
 * declarants and staff.
 */
@Module({
  imports: [DirectoryModule],
  controllers: [ObligationsController, RosterEventsConsumer],
  providers: [
    ObligationsService,
    CommissionObligationsService,
    RosterIngest,
    { provide: Clock, useClass: SystemClock },
    { provide: ObligationWorkflows, useClass: DeferredObligationWorkflows },
  ],
})
export class ObligationsModule {}
