import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeIdempotent, type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { EXTRACT_DOCUMENT } from '../ai-gateway/ai-gateway-client.js';
import { DocumentReadingWorkflows } from './document-reading-workflows.js';
import { declarationOfSubjectRef } from './extraction.service.js';

/** The ai-gateway's announcements that a job ended (its `jobs/events.ts`). */
export const AI_JOB_COMPLETED = 'ai.job.completed.v1';
export const AI_JOB_FAILED = 'ai.job.failed.v1';
export const AI_JOB_BLOCKED = 'ai.job.blocked.v1';

/** The inbox consumer name of the `ai.job.*` events. */
export const EXTRACTION_JOB_CONSUMER = 'declarations.extraction-job';

/** What the consumer reads of an `ai.job.*` event: identifiers only. */
const jobFinishedData = z.object({
  jobId: z.uuid(),
  task: z.string(),
  subjectRef: z.string(),
});

/**
 * The ai-gateway's events that a job ended (spec 05b S6). For an `extract-document` job about a
 * declaration (`subjectRef` `declaration:<id>`) it tells that job's `DocumentReadingWorkflow`,
 * which settles the sets as the declarant who asked (ADR-018: the person comes from their token,
 * carried by the workflow, never from the event). It reads and writes nothing itself. Other
 * services' jobs, and jobs no reading waits for, are left alone. Each event is recorded in the
 * inbox once handled; a handler that throws (Temporal unreachable) is retried once, then
 * dead-lettered, and the workflow's own pull settles the reading.
 */
@Controller()
export class ExtractionJobConsumer {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly workflows: DocumentReadingWorkflows,
  ) {}

  @OnEvent(AI_JOB_COMPLETED)
  completed(@Payload() event: EventEnvelope): Promise<void> {
    return this.finished(event);
  }

  @OnEvent(AI_JOB_FAILED)
  failed(@Payload() event: EventEnvelope): Promise<void> {
    return this.finished(event);
  }

  @OnEvent(AI_JOB_BLOCKED)
  blocked(@Payload() event: EventEnvelope): Promise<void> {
    return this.finished(event);
  }

  private async finished(event: EventEnvelope): Promise<void> {
    const { jobId, task, subjectRef } = jobFinishedData.parse(event.data);
    if (task !== EXTRACT_DOCUMENT) return;
    const declarationId = declarationOfSubjectRef(subjectRef);
    if (declarationId === null) return;
    await consumeIdempotent(this.db, EXTRACTION_JOB_CONSUMER, event, () =>
      this.workflows.jobFinished(declarationId, jobId),
    );
  }
}
