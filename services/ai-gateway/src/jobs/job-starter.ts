import { Inject, Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import type { AiJobInput, aiJob } from './workflows.js';

export const JOB_STARTER_OPTIONS = Symbol('JOB_STARTER_OPTIONS');

export interface JobStarterOptions {
  taskQueue: string;
  /** Longest a single execution attempt may take. */
  attemptTimeoutMs: number;
}

/** Starts the `aiJob` workflow of a job; one workflow per job, keyed by the job id. */
@Injectable()
export class JobStarter {
  constructor(
    @InjectTemporalClient() private readonly client: Client,
    @Inject(JOB_STARTER_OPTIONS) private readonly options: JobStarterOptions,
  ) {}

  /** Idempotent: starting a job whose workflow already runs does nothing. */
  async start(jobId: string): Promise<void> {
    const input: AiJobInput = { jobId, attemptTimeoutMs: this.options.attemptTimeoutMs };
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.client.workflow.start<typeof aiJob>('aiJob', {
        workflowId: `ai-job-${jobId}`,
        taskQueue: this.options.taskQueue,
        args: [input],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
