import { setTimeout as sleep } from 'node:timers/promises';

import { Inject, Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';

import type { AiJobInput, aiJob } from './workflows.js';

export const JOB_STARTER_OPTIONS = Symbol('JOB_STARTER_OPTIONS');

export interface JobStarterOptions {
  taskQueue: string;
  /** Longest a single execution attempt may take. */
  attemptTimeoutMs: number;
}

/** Whether a job's workflow runs, has ended, or does not exist (never started, or purged). */
export type WorkflowState = 'running' | 'closed' | 'missing';

/** Starts and observes the `aiJob` workflow of a job; one workflow per job, keyed by the job id. */
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
        workflowId: workflowId(jobId),
        taskQueue: this.options.taskQueue,
        args: [input],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  async state(jobId: string): Promise<WorkflowState> {
    try {
      const { status } = await this.client.workflow.getHandle(workflowId(jobId)).describe();
      return status.name === 'RUNNING' ? 'running' : 'closed';
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return 'missing';
      throw error;
    }
  }

  /**
   * Resolves when the job's workflow ends or `ms` pass, whichever is first. The workflow ends
   * only after the job's final state is committed. Never throws: the caller reads the job.
   */
  async waitForEnd(jobId: string, ms: number): Promise<void> {
    const timer = new AbortController();
    await Promise.race([
      this.client.workflow
        .getHandle(workflowId(jobId))
        .result()
        .catch(() => undefined),
      sleep(ms, undefined, { signal: timer.signal }).catch(() => undefined),
    ]);
    timer.abort();
  }
}

function workflowId(jobId: string): string {
  return `ai-job-${jobId}`;
}
