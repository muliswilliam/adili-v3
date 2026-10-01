import type { Logger } from '@nestjs/common';

import type { CancelReason } from './engine.js';

/**
 * What happened to obligations in a committed transaction, for their workflows: created ones get
 * a `FilingObligationWorkflow` started (workflow id = obligation id), cancelled ones a `cancel`
 * signal, those linked to an onboarded person a `personLinked` signal so reminders start, and
 * those a submission filed a `filed` signal so the workflow ends (slice 06).
 */
export interface ObligationChanges {
  created: string[];
  cancelled: { obligationId: string; reason: CancelReason }[];
  personLinked: string[];
  filed: string[];
}

export function noChanges(): ObligationChanges {
  return { created: [], cancelled: [], personLinked: [], filed: [] };
}

export function hasChanges(changes: ObligationChanges): boolean {
  return (
    changes.created.length > 0 ||
    changes.cancelled.length > 0 ||
    changes.personLinked.length > 0 ||
    changes.filed.length > 0
  );
}

/**
 * An obligation's workflow run that ended without completing: it failed, timed out, was
 * terminated or was cancelled on Temporal, so nothing sends its reminders any more.
 */
export interface StoppedWorkflow {
  obligationId: string;
  /** When that run closed. */
  closedAt: Date;
}

/**
 * Starts and signals obligation workflows (ADR-003), called after the transaction that changed
 * the obligations commits. Starts and signals are idempotent by workflow id, and a failure here
 * is not retried by the caller: the reconciliation sweep starts a workflow for any open obligation
 * without a running one, whether it was never started (`workflow_started_at` is null) or its run
 * stopped (`stopped`). Implemented on Temporal by `TemporalObligationWorkflows`; a Nest token so
 * tests record the calls.
 */
export abstract class ObligationWorkflows {
  /**
   * Starts a workflow for every created obligation that has none running and did not complete
   * (a run that stopped is started again), signals the others.
   */
  abstract apply(tenant: string, changes: ObligationChanges): Promise<void>;

  /** Every run of an obligation workflow that stopped without completing, in no order. */
  abstract stopped(): AsyncIterable<StoppedWorkflow>;
}

/**
 * Tells the workflows what a committed transaction changed. A failure is logged, not thrown: the
 * changes are in, and the reconciliation sweep starts the workflows that did not start.
 */
export async function tellWorkflows(
  workflows: ObligationWorkflows,
  logger: Pick<Logger, 'warn'>,
  tenant: string,
  changes: ObligationChanges,
): Promise<void> {
  if (!hasChanges(changes)) return;
  try {
    await workflows.apply(tenant, changes);
  } catch (error) {
    logger.warn({ err: error, tenant }, 'Obligation workflows not started or signalled');
  }
}
