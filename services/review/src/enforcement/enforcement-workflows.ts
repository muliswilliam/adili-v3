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
 * subject is left as it is. A restart replaces whatever run is still open (`restart`).
 */
@Injectable()
export class EnforcementWorkflows {
  private readonly logger = new Logger(EnforcementWorkflows.name);

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: EnforcementInput): Promise<void> {
    try {
      await this.run(input, 'USE_EXISTING');
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  /**
   * A supervisor's restart of a declined ladder: a new run, terminating the subject's run if one
   * is still open. That can only be the declined run on its way out (it has read, or is about to
   * read, the decline, and records nothing more), which a start that joined it would leave the
   * restarted ladder with no workflow behind it (#509). Called with the declined ladder locked,
   * so no other restart's run can be the one terminated.
   */
  async restart(input: EnforcementInput): Promise<void> {
    await this.run(input, 'TERMINATE_EXISTING');
  }

  private async run(
    input: EnforcementInput,
    workflowIdConflictPolicy: 'USE_EXISTING' | 'TERMINATE_EXISTING',
  ): Promise<void> {
    // By name: workflow code is loaded by the worker's bundler, not by this process.
    await this.temporal.workflow.start<typeof enforcement>(ENFORCEMENT_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: enforcementWorkflowId(input.subjectKind, input.subjectId),
      args: [input],
      workflowIdConflictPolicy,
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    });
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
