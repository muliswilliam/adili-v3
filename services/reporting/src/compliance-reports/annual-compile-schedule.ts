import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { config } from '../config.js';
import { ANNUAL_COMPILE_WORKFLOW, annualCompileScheduleId } from './contract.js';
import { YearlySchedule } from './yearly-schedule.js';

/**
 * The Temporal schedule of the yearly compile (spec 09: Form M is compiled at the end of each
 * financial year), which the service keeps on start: `ANNUAL_COMPILE_CRON` in Nairobi time,
 * 06:00 on 1 July by default; `off` keeps none.
 */
@Injectable()
export class AnnualCompileSchedule extends YearlySchedule {
  constructor(@InjectTemporalClient() temporal: Client) {
    super(temporal, {
      cron: config.ANNUAL_COMPILE_CRON,
      scheduleId: annualCompileScheduleId(config.TEMPORAL_TASK_QUEUE),
      workflowType: ANNUAL_COMPILE_WORKFLOW,
    });
  }
}
