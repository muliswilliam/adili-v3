import { Injectable, Logger } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';

import { config } from '../config.js';
import {
  CLOSED_SIGNAL,
  DECIDED_SIGNAL,
  ENFORCEMENT_WORKFLOW,
  type EnforcementInput,
  enforcementWorkflowId,
} from './contract.js';
import type { ClosingCause, SubjectKind } from './schema.js';
import type { enforcement } from './workflows.js';

/** The subject a ladder's workflow is keyed by. */
export interface LadderSubject {
  subjectKind: SubjectKind;
  subjectId: string;
}

/**
 * Starts `EnforcementWorkflow` on Temporal (ADR-003), one per subject, and signals it when an
 * officer decides its step or the ladder closes. A start is idempotent: a running workflow for the
 * subject is left as it is; a closed one (a declined ladder) is followed by the restart's new run.
 */
@Injectable()
export class EnforcementWorkflows {
  private readonly logger = new Logger(EnforcementWorkflows.name);

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: EnforcementInput): Promise<void> {
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof enforcement>(ENFORCEMENT_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: enforcementWorkflowId(input.subjectKind, input.subjectId),
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  /**
   * Tells the workflow its step was decided, from inside the deciding transaction: Temporal out of
   * reach fails the decision, so none is left unseen. A workflow that has ended has nothing to
   * decide; the workflow reads the step itself, so an early signal only makes it look sooner.
   */
  async decided(subject: LadderSubject): Promise<void> {
    try {
      await this.handle(subject).signal(DECIDED_SIGNAL);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  }

  /** Tells the workflow its ladder closed, from inside the transaction that closed it. */
  async closed(subject: LadderSubject, cause: ClosingCause): Promise<void> {
    try {
      await this.handle(subject).signal(CLOSED_SIGNAL, cause);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
      this.logger.debug({ ...subject, cause }, 'No EnforcementWorkflow to tell of the closing');
    }
  }

  private handle({ subjectKind, subjectId }: LadderSubject) {
    return this.temporal.workflow.getHandle(enforcementWorkflowId(subjectKind, subjectId));
  }
}
