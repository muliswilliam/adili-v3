import { Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { sql } from 'drizzle-orm';

import { config } from './config.js';
import type { AccessTransaction } from './db/database.js';
import { workflowUnavailable } from './problems.js';

/**
 * Starting and signalling the access workflows (ADR-003), one way for all three
 * (`AccessRequestWorkflow`, `LeaRequestWorkflow`, `CertifiedCopyWorkflow`).
 *
 * Start inside the transaction that records what the workflow follows, before it commits, and
 * pass the transaction's id (`currentTransactionId`) to the workflow:
 *
 * - Temporal unreachable fails the start, so the transaction rolls back (503
 *   `workflow-unavailable`): a record never commits without its workflow. Starting after the
 *   commit instead would leave it without one whenever the process died or Temporal failed in
 *   between, with nothing to start it again.
 * - The workflow's first activity waits until that transaction has ended
 *   (`requireTransactionEnded`): it never reads a record that is not committed yet as missing, or
 *   a re-ordered one in its old state, and a transaction that rolled back after the start ends
 *   the workflow at once ('missing') rather than leaving it to act on nothing.
 * - Start before taking any lock other transactions queue for (the per-Commission reference
 *   counter): the Temporal round trip then holds none.
 *
 * Signal after the transaction that changed the record commits. The workflows read the record on
 * a timer while they wait, so a signal lost here only delays them.
 */

const logger = new Logger('AccessWorkflows');

/** A workflow to start: its type and id, its arguments, and what to tell the caller if it fails. */
export interface WorkflowStart {
  /** The workflow type, started by name: the worker bundles the code, not this process. */
  type: string;
  workflowId: string;
  args: unknown[];
  /** The 503 `workflow-unavailable` detail when Temporal cannot be reached. */
  unavailable: string;
  /**
   * What to do with a run already open under the id. `keep` (the default): it is the run that
   * follows the record, so it is left as it is (a retried start, or a re-order of a record still
   * in progress). `replace`: the record was reopened from a state its last run left it in for
   * good (e.g. a failed certified copy ordered again), so the open run is that one, past its last
   * write and about to close without reading the record again; it is terminated and a new run
   * started. Kept, it would leave the record with no workflow behind it.
   */
  onRunning?: 'keep' | 'replace';
}

/**
 * Starts a workflow, idempotently: one running under the same id is left as it is (a retried
 * start, or a re-order of a record still in progress) unless `onRunning` is `replace`; one that
 * ended is started afresh. Temporal unreachable is logged and thrown as 503 `workflow-unavailable`, which
 * rolls the caller's transaction back.
 */
export async function startWorkflow(temporal: Client, start: WorkflowStart): Promise<void> {
  try {
    await temporal.workflow.start(start.type, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: start.workflowId,
      args: start.args,
      workflowIdConflictPolicy:
        start.onRunning === 'replace' ? 'TERMINATE_EXISTING' : 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    });
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return;
    logger.error(
      { workflowId: start.workflowId, err: errorType(error) },
      'Could not start the workflow',
    );
    throw workflowUnavailable(start.unavailable);
  }
}

/**
 * Tells a workflow its record changed, after the change has committed. One that ended has nothing
 * to do; one Temporal cannot reach now is logged, not failed: the change stands, and the workflow
 * reads the record on a timer while it waits.
 */
export async function signalWorkflow(
  temporal: Client,
  workflowId: string,
  signal: string,
): Promise<void> {
  try {
    await temporal.workflow.getHandle(workflowId).signal(signal);
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) return;
    logger.warn({ workflowId, signal, err: errorType(error) }, 'Could not signal the workflow');
  }
}

/**
 * The id of the open transaction `tx` (Postgres `xid8`, as text), for the workflow it starts to
 * wait on (`requireTransactionEnded`). Assigns one if the transaction has not written yet.
 */
export async function currentTransactionId(tx: AccessTransaction): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`select pg_current_xact_id()::text as id`);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('The transaction has no id');
  return id;
}
