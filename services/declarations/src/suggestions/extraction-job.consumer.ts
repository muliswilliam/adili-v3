import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { EXTRACT_DOCUMENT } from '../ai-gateway/ai-gateway-client.js';
import { declarationOfSubjectRef, ExtractionService } from './extraction.service.js';

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

const tenantSchema = z.string().regex(TENANT_KEY);

/**
 * The ai-gateway's events that a job ended (spec 05b S6). An `extract-document` job about a
 * declaration (`subjectRef` `declaration:<id>`) settles the document sets waiting for it: the
 * service pulls the job and records its reading, or why there is none. Other services' jobs are
 * left alone. Each event is handled once (inbox); a handler that throws (the gateway did not
 * answer the pull) is retried once, then dead-lettered, and the declarant asking again pulls it.
 */
@Controller()
export class ExtractionJobConsumer {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly extractions: ExtractionService,
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
    const tenant = tenantSchema.parse(event.tenant);
    await consumeOnce(this.db, EXTRACTION_JOB_CONSUMER, event, () =>
      this.extractions.jobFinished(tenant, declarationId, jobId),
    );
  }
}
