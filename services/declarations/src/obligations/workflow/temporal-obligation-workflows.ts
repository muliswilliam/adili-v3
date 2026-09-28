import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { InjectTemporalClient } from '@adili/temporal';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { and, inArray, isNull, sql } from 'drizzle-orm';

import { config } from '../../config.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import { systemContext } from '../system-context.js';
import { filingObligations } from '../schema.js';
import { type ObligationChanges, ObligationWorkflows } from '../workflows.js';
import {
  cancelSignal,
  FILING_OBLIGATION_WORKFLOW,
  type FilingObligationInput,
  personLinkedSignal,
} from './contract.js';
import type { filingObligation } from './workflows.js';

/** Starts and signals in flight at once: a page brings up to 1,000 of each. */
const CONCURRENCY = 25;

/**
 * Starts and signals `FilingObligationWorkflow`s on Temporal (ADR-003), one per obligation with the
 * obligation id as workflow id. A start is idempotent (a running or finished workflow is left as
 * it is) and marks the obligation `workflow_started_at`; a signal to a workflow that was never
 * started is dropped, since that obligation is unmarked and the sweep starts its workflow, which
 * reads the current row. Every call is attempted; failures are thrown together at the end.
 */
@Injectable()
export class TemporalObligationWorkflows extends ObligationWorkflows {
  private readonly logger = new Logger(TemporalObligationWorkflows.name);

  constructor(
    @InjectTemporalClient() private readonly temporal: Client,
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
  ) {
    super();
  }

  async apply(tenant: string, changes: ObligationChanges): Promise<void> {
    const failures: unknown[] = [];
    const started = await eachSettled(changes.created, failures, (id) => this.start(id));
    if (started.length > 0) await this.markStarted(tenant, started);
    await eachSettled(changes.cancelled, failures, ({ obligationId, reason }) =>
      this.signal(obligationId, (handle) => handle.signal(cancelSignal, reason)),
    );
    await eachSettled(changes.personLinked, failures, (obligationId) =>
      this.signal(obligationId, (handle) => handle.signal(personLinkedSignal)),
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${String(failures.length)} obligation workflow calls failed for ${tenant}`,
      );
    }
  }

  private async start(obligationId: string): Promise<string> {
    const input: FilingObligationInput = { obligationId };
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof filingObligation>(FILING_OBLIGATION_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: obligationId,
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        // One workflow per obligation, ever: a finished one is not run again.
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
    return obligationId;
  }

  private async signal(
    obligationId: string,
    send: (handle: ReturnType<Client['workflow']['getHandle']>) => Promise<void>,
  ): Promise<void> {
    try {
      await send(this.temporal.workflow.getHandle(obligationId));
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
      this.logger.debug({ obligationId }, 'No workflow to signal yet; the sweep starts it');
    }
  }

  private async markStarted(tenant: string, obligationIds: string[]): Promise<void> {
    await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .update(filingObligations)
        .set({ workflowStartedAt: sql`now()` })
        .where(
          and(
            inArray(filingObligations.id, obligationIds),
            isNull(filingObligations.workflowStartedAt),
          ),
        ),
    );
  }
}

/**
 * Runs `work` for every item, `CONCURRENCY` at a time; returns the results of those that
 * succeeded and collects the errors of the others.
 */
async function eachSettled<T, R>(
  items: readonly T[],
  failures: unknown[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    const settled = await Promise.allSettled(items.slice(start, start + CONCURRENCY).map(work));
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') results.push(outcome.value);
      else failures.push(outcome.reason);
    }
  }
  return results;
}
