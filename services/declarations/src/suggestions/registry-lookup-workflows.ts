import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { config } from '../config.js';
import {
  REGISTRY_LOOKUPS_WORKFLOW,
  type RegistryLookupsInput,
  registryLookupsWorkflowId,
} from './workflow/contract.js';
import type { registryLookups } from './workflow/workflows.js';

/**
 * Starts the lookup workflow of a request once its sets are committed (ADR-003). A Nest token so
 * the service can be tested without Temporal; `TemporalRegistryLookupWorkflows` is the one used.
 */
export abstract class RegistryLookupWorkflows {
  /** Starts it; idempotent by the request's consent id. Throws when Temporal cannot be reached. */
  abstract start(input: RegistryLookupsInput): Promise<void>;
}

@Injectable()
export class TemporalRegistryLookupWorkflows extends RegistryLookupWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {
    super();
  }

  async start(input: RegistryLookupsInput): Promise<void> {
    // By name: workflow code is loaded by the worker's bundler, not by this process.
    await this.temporal.workflow.start<typeof registryLookups>(REGISTRY_LOOKUPS_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: registryLookupsWorkflowId(input.consentId),
      args: [input],
      workflowIdConflictPolicy: 'USE_EXISTING',
    });
  }
}
