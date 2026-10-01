import {
  type Client,
  type Workflow,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';

import { config } from './config.js';

/**
 * Starts the workflow `type` as `workflowId` on the reporting queue, by name: workflow code is
 * loaded by the worker's bundler, not by this process. False when it runs already, so a retried
 * start is fine.
 */
export async function startOnce<W extends Workflow>(
  temporal: Client,
  type: string,
  workflowId: string,
  args: Parameters<W>,
): Promise<boolean> {
  try {
    await temporal.workflow.start<Workflow>(type, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId,
      args,
    });
    return true;
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return false;
    throw error;
  }
}
