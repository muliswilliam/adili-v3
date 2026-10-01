import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { config } from '../config.js';
import { SweepScheduling } from '../sweep-schedule.js';
import {
  REGISTRY_CHECK_WORKFLOW,
  REGISTRY_SWEEP_WORKFLOW,
  type RegistryCheckRequest,
  registryRecheckWorkflowId,
  registrySweepScheduleId,
} from './contract.js';
import type { registryCheck } from './workflows.js';

/**
 * Starts the registry check workflows on Temporal (ADR-003): a check of a case a reviewer or
 * supervisor asked for, and the schedule of the hourly sweep of cases with a registry still
 * unavailable, which the service keeps on start (`REGISTRY_SWEEP_CRON` in Nairobi time; `off`
 * keeps none). Workflows are started by name: the worker bundles the code.
 */
@Injectable()
export class RegistryWorkflows extends SweepScheduling {
  constructor(@InjectTemporalClient() temporal: Client) {
    super(temporal, {
      name: 'registry',
      workflowType: REGISTRY_SWEEP_WORKFLOW,
      scheduleId: registrySweepScheduleId(config.TEMPORAL_TASK_QUEUE),
      cron: config.REGISTRY_SWEEP_CRON,
    });
  }

  /** A re-check of the case at its current version: one `registryCheck` per request. */
  async startRecheck(request: RegistryCheckRequest, recheckId: string): Promise<void> {
    await this.temporal.workflow.start<typeof registryCheck>(REGISTRY_CHECK_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: registryRecheckWorkflowId(request.caseId, recheckId),
      args: [request],
    });
  }
}
