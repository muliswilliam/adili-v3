import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { CopilotWorkflows } from './copilot-workflows.js';
import { AI_JOB_BLOCKED, AI_JOB_COMPLETED, AI_JOB_FAILED, caseOfSubjectRef } from './events.js';

/** The inbox consumer name of the `ai.job.*` events. */
export const AI_JOB_CONSUMER = 'review.ai-job';

/** What the consumer reads from `ai.job.completed.v1`, `failed.v1` and `blocked.v1`. */
const jobFinishedData = z.object({
  jobId: z.uuid(),
  task: z.string(),
  subjectRef: z.string(),
});

/** Drafts are read when the reviewer polls them (copilot-drafts.service.ts), not on events. */
const POLLED_TASKS: readonly string[] = ['draft-clarification'];

const tenantSchema = z.string().regex(TENANT_KEY);
const caseIdSchema = z.uuid();

/**
 * The ai-gateway's announcements that a job has ended (spec 07c). The events carry identifiers,
 * hashes and counts only; for a job about a review case (`subjectRef` `review-case:<id>`) the
 * consumer starts `copilotJobFinished`, which pulls the outcome and records it. Jobs about
 * anything else are other services', and a case's clarification drafts are polled instead. Each event is handled once (inbox); the start is idempotent
 * by job. A handler that throws (Temporal unreachable) is retried once, then dead-lettered.
 */
@Controller()
export class AiJobConsumer {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly workflows: CopilotWorkflows,
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
    if (POLLED_TASKS.includes(task)) return;
    const caseId = caseIdSchema.safeParse(caseOfSubjectRef(subjectRef));
    if (!caseId.success) return;
    const tenant = tenantSchema.parse(event.tenant);
    await consumeOnce(this.db, AI_JOB_CONSUMER, event, () =>
      this.workflows.jobFinished({ tenant, caseId: caseId.data, jobId }),
    );
  }
}
