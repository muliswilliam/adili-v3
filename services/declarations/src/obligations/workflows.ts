import { Injectable, Logger } from '@nestjs/common';

import type { CancelReason } from './engine.js';

/**
 * What happened to obligations in a committed transaction, for their workflows: created ones get
 * a `FilingObligationWorkflow` started (workflow id = obligation id), cancelled ones a `cancel`
 * signal, and those linked to an onboarded person a `personLinked` signal so reminders start.
 */
export interface ObligationChanges {
  created: string[];
  cancelled: { obligationId: string; reason: CancelReason }[];
  personLinked: string[];
}

export function noChanges(): ObligationChanges {
  return { created: [], cancelled: [], personLinked: [] };
}

export function hasChanges(changes: ObligationChanges): boolean {
  return (
    changes.created.length > 0 || changes.cancelled.length > 0 || changes.personLinked.length > 0
  );
}

/**
 * Starts and signals obligation workflows (ADR-003), called after the transaction that changed
 * the obligations commits. Starts and signals are idempotent by workflow id, and a failure here
 * is not retried by the caller: the reconciliation sweep starts a workflow for any obligation
 * without a running one (`workflow_started_at` is null). A Nest token so tests record the calls.
 */
export abstract class ObligationWorkflows {
  abstract apply(tenant: string, changes: ObligationChanges): Promise<void>;
}

/**
 * Until `FilingObligationWorkflow` exists (#94) nothing is started: obligations keep their status
 * as created and no reminders go out. #94 replaces this with the Temporal client.
 */
@Injectable()
export class DeferredObligationWorkflows extends ObligationWorkflows {
  private readonly logger = new Logger(DeferredObligationWorkflows.name);

  apply(tenant: string, changes: ObligationChanges): Promise<void> {
    this.logger.debug(
      {
        tenant,
        created: changes.created.length,
        cancelled: changes.cancelled.length,
        personLinked: changes.personLinked.length,
      },
      'Obligation workflows not started yet (#94)',
    );
    return Promise.resolve();
  }
}
