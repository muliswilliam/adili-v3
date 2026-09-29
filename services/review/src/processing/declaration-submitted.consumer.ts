import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { TENANT_SLUG } from '../cases/access.js';
import { DECLARATION_SUBMITTED } from '../cases/events.js';
import { ProcessingWorkflows } from './processing-workflows.js';

/** The inbox consumer name of `declaration.submitted.v1`. */
export const DECLARATION_SUBMITTED_CONSUMER = 'review.declaration-submitted';

/** The identifiers the consumer reads from `declaration.submitted.v1` (spec 06). */
const submittedData = z.object({
  declarationId: z.uuid(),
  versionId: z.uuid(),
  version: z.int().positive(),
});

const tenantSchema = z.string().regex(TENANT_SLUG);

/**
 * Starts `DeclarationProcessingWorkflow` for every submitted version (spec 07a). The event carries
 * identifiers only; the workflow pulls the version. Each event is handled once (inbox); the start
 * is idempotent by version, so the same version announced again starts nothing. A handler that
 * throws (Temporal unreachable) is retried once, then dead-lettered.
 */
@Controller()
export class DeclarationSubmittedConsumer {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly workflows: ProcessingWorkflows,
  ) {}

  @OnEvent(DECLARATION_SUBMITTED)
  async submitted(@Payload() event: EventEnvelope): Promise<void> {
    const { declarationId, versionId, version } = submittedData.parse(event.data);
    const tenant = tenantSchema.parse(event.tenant);
    // The start is inside the inbox transaction: if it fails, the event is not marked handled.
    await consumeOnce(this.db, DECLARATION_SUBMITTED_CONSUMER, event, () =>
      this.workflows.start({ tenant, declarationId, versionId, version }),
    );
  }
}
