import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';

import { ProviderError } from '../providers/port.js';
import { ReplayFixtureMissingError } from '../providers/replay.adapter.js';
import { PROVIDER_ERROR } from './failures.js';
import { JobExecutor, ResultNotRecordedError } from './job-executor.js';
import type { JobReason } from './job-states.js';

/** Time the attempt keeps after the executor gives up, to report it before Temporal times out. */
const ATTEMPT_DEADLINE_MARGIN_MS = 5_000;

/**
 * Temporal activities of the `aiJob` workflow; every public method is registered by name.
 * Provider errors become application failures the retry policy understands: transient kinds
 * are retried, the rest fail the job at once. Other errors (a database outage) are retried.
 */
@Injectable()
export class JobActivities {
  constructor(private readonly executor: JobExecutor) {}

  async executeJob(jobId: string): Promise<void> {
    const { currentAttemptScheduledTimestampMs, startToCloseTimeoutMs } = Context.current().info;
    const deadline =
      currentAttemptScheduledTimestampMs + startToCloseTimeoutMs - ATTEMPT_DEADLINE_MARGIN_MS;
    try {
      await this.executor.execute(jobId, deadline);
    } catch (error) {
      throw toFailure(error);
    }
  }

  async failJob(jobId: string, reason: JobReason): Promise<void> {
    await this.executor.fail(jobId, reason);
  }
}

function toFailure(error: unknown): unknown {
  if (error instanceof ProviderError) {
    // The message names the kind and provider, never prompt or output content.
    return ApplicationFailure.create({
      type: `${PROVIDER_ERROR}:${error.kind}`,
      message: error.message,
      nonRetryable: !error.retryable,
      nextRetryDelay:
        error.retryAfterSeconds === undefined ? undefined : `${error.retryAfterSeconds} seconds`,
    });
  }
  if (error instanceof ResultNotRecordedError) {
    return ApplicationFailure.nonRetryable(error.message, error.name);
  }
  if (error instanceof ReplayFixtureMissingError) {
    // Replays cannot conjure a fixture on retry.
    return ApplicationFailure.nonRetryable(error.message, error.name);
  }
  return error;
}
