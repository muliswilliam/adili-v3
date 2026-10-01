import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, EventPublisher, OnEvent } from '@adili/events';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { TENANT_KEY } from '@adili/api-kit';
import {
  CLARIFICATION_OVERDUE,
  CLARIFICATION_RESOLVED,
  CLARIFICATION_RESPONDED,
  CLARIFICATION_WITHDRAWN,
} from '../clarifications/events.js';
import { Clock } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { withInboxTenant } from '../system-context.js';
import { EnforcementWorkflows, type LadderSubject } from './enforcement-workflows.js';
import { closeLadderRecords } from './ladder-records.js';
import { type ClosingCause, enforcementLadders } from './schema.js';

/**
 * `obligation.status-changed.v1` (spec 04, declarations): an obligation moved between states.
 * Identifiers and states only.
 */
export const OBLIGATION_STATUS_CHANGED = 'obligation.status-changed.v1';

/** The inbox consumer names, one per event type. */
export const ENFORCEMENT_CONSUMERS = {
  obligationStatusChanged: 'review.enforcement.obligation-status-changed',
  clarificationOverdue: 'review.enforcement.clarification-overdue',
  clarificationResponded: 'review.enforcement.clarification-responded',
  clarificationResolved: 'review.enforcement.clarification-resolved',
  clarificationWithdrawn: 'review.enforcement.clarification-withdrawn',
} as const;

const tenantSchema = z.string().regex(TENANT_KEY);

const obligationStatuses = z.enum(['upcoming', 'due', 'overdue', 'filed', 'cancelled']);

/** What the consumer reads from `obligation.status-changed.v1` (spec 04). */
const obligationStatusChanged = z.object({
  obligationId: z.uuid(),
  from: obligationStatuses,
  to: obligationStatuses,
});

/** What the consumer reads from the `clarification.*` events (spec 07a). */
const clarificationEvent = z.object({ clarificationId: z.uuid() });

/**
 * Starts and closes the enforcement ladder from events (spec 08, refines ADR-003): an obligation
 * going `overdue` or a clarification going unanswered (`clarification.overdue.v1`) starts
 * `EnforcementWorkflow` for it; the obligation `filed`, or the clarification answered or resolved,
 * is compliance and closes its ladder; an obligation cancelled or a clarification withdrawn ends
 * it. Each event is handled once (inbox), in one transaction with what it changes: a start or a
 * signal Temporal cannot take fails the handler, which is retried.
 */
@Controller()
export class EnforcementConsumer {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly workflows: EnforcementWorkflows,
    private readonly clock: Clock,
  ) {}

  @OnEvent(OBLIGATION_STATUS_CHANGED)
  async obligationStatusChanged(@Payload() event: EventEnvelope): Promise<void> {
    const { obligationId, to } = obligationStatusChanged.parse(event.data);
    const tenant = tenantSchema.parse(event.tenant);
    const subject: LadderSubject = { subjectKind: 'obligation', subjectId: obligationId };
    await this.consume(ENFORCEMENT_CONSUMERS.obligationStatusChanged, event, tenant, subject, {
      start: to === 'overdue',
      closing: to === 'filed' ? 'filed' : to === 'cancelled' ? 'obligation-cancelled' : null,
    });
  }

  @OnEvent(CLARIFICATION_OVERDUE)
  async clarificationOverdue(@Payload() event: EventEnvelope): Promise<void> {
    await this.clarification(ENFORCEMENT_CONSUMERS.clarificationOverdue, event, {
      start: true,
      closing: null,
    });
  }

  @OnEvent(CLARIFICATION_RESPONDED)
  async clarificationResponded(@Payload() event: EventEnvelope): Promise<void> {
    await this.clarification(ENFORCEMENT_CONSUMERS.clarificationResponded, event, {
      start: false,
      closing: 'clarification-responded',
    });
  }

  @OnEvent(CLARIFICATION_RESOLVED)
  async clarificationResolved(@Payload() event: EventEnvelope): Promise<void> {
    await this.clarification(ENFORCEMENT_CONSUMERS.clarificationResolved, event, {
      start: false,
      closing: 'clarification-resolved',
    });
  }

  @OnEvent(CLARIFICATION_WITHDRAWN)
  async clarificationWithdrawn(@Payload() event: EventEnvelope): Promise<void> {
    await this.clarification(ENFORCEMENT_CONSUMERS.clarificationWithdrawn, event, {
      start: false,
      closing: 'clarification-withdrawn',
    });
  }

  private async clarification(
    consumer: string,
    event: EventEnvelope,
    effect: { start: boolean; closing: ClosingCause | null },
  ): Promise<void> {
    const { clarificationId } = clarificationEvent.parse(event.data);
    const tenant = tenantSchema.parse(event.tenant);
    const subject: LadderSubject = { subjectKind: 'clarification', subjectId: clarificationId };
    await this.consume(consumer, event, tenant, subject, effect);
  }

  /**
   * Once per event: starts the subject's workflow, or closes its ladder (the records now, then the
   * workflow told, which only stops its timers).
   */
  private async consume(
    consumer: string,
    event: EventEnvelope,
    tenant: string,
    subject: LadderSubject,
    { start, closing }: { start: boolean; closing: ClosingCause | null },
  ): Promise<void> {
    if (!start && closing === null) return;
    await consumeOnce(this.db as unknown as Database, consumer, event, async (inboxTx) => {
      if (start) {
        await this.workflows.start({ tenant, ...subject });
        return;
      }
      if (closing === null) return;
      const tx = await withInboxTenant(inboxTx, tenant);
      const [ladder] = await tx
        .select({ id: enforcementLadders.id, status: enforcementLadders.status })
        .from(enforcementLadders)
        .where(
          and(
            eq(enforcementLadders.tenant, tenant),
            eq(enforcementLadders.subjectKind, subject.subjectKind),
            eq(enforcementLadders.subjectId, subject.subjectId),
          ),
        );
      if (!ladder) return;
      await closeLadderRecords(tx, this.events, ladder.id, closing, this.clock.now());
      if (ladder.status === 'active') await this.workflows.closed(subject, closing);
    });
  }
}
