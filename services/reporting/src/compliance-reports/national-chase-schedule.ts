import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { config } from '../config.js';
import { NATIONAL_CHASE_START_WORKFLOW, nationalChaseScheduleId } from './contract.js';
import { YearlySchedule } from './yearly-schedule.js';

/**
 * The Temporal schedule that starts EACC's chase of non-reporting Commissions (spec 09: from
 * 1 August), which the service keeps on start: `NATIONAL_CHASE_CRON` in Nairobi time, 06:00 on
 * 1 August by default; `off` keeps none.
 */
@Injectable()
export class NationalChaseSchedule extends YearlySchedule {
  constructor(@InjectTemporalClient() temporal: Client) {
    super(temporal, {
      cron: config.NATIONAL_CHASE_CRON,
      scheduleId: nationalChaseScheduleId(config.TEMPORAL_TASK_QUEUE),
      workflowType: NATIONAL_CHASE_START_WORKFLOW,
    });
  }
}
