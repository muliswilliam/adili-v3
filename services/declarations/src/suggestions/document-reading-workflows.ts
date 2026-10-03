import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowNotFoundError } from '@temporalio/client';

import { config } from '../config.js';
import {
  DOCUMENT_READING_WORKFLOW,
  type DocumentReadingInput,
  documentReadingWorkflowId,
  READING_JOB_FINISHED_SIGNAL,
} from './workflow/contract.js';
import type { documentReading } from './workflow/workflows.js';

/**
 * Starts a reading's workflow once its set is recorded, and tells it the job ended (ADR-003). A
 * Nest token so the service can be tested without Temporal; `TemporalDocumentReadingWorkflows`
 * is the one used.
 */
export abstract class DocumentReadingWorkflows {
  /** Starts it; one per declaration and job. Throws when Temporal cannot be reached. */
  abstract start(input: DocumentReadingInput): Promise<void>;

  /** Signals that the job ended; nothing when no such workflow runs (settled, or never started). */
  abstract jobFinished(declarationId: string, jobId: string): Promise<void>;
}

@Injectable()
export class TemporalDocumentReadingWorkflows extends DocumentReadingWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {
    super();
  }

  async start(input: DocumentReadingInput): Promise<void> {
    await this.temporal.workflow.start<typeof documentReading>(DOCUMENT_READING_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: documentReadingWorkflowId(input.declarationId, input.jobId),
      args: [input],
      workflowIdConflictPolicy: 'USE_EXISTING',
    });
  }

  async jobFinished(declarationId: string, jobId: string): Promise<void> {
    try {
      await this.temporal.workflow
        .getHandle(documentReadingWorkflowId(declarationId, jobId))
        .signal(READING_JOB_FINISHED_SIGNAL);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  }
}
