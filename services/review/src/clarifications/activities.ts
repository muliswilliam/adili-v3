import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ApplicationFailure } from '@temporalio/common';
import { and, eq, isNull } from 'drizzle-orm';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

import { clarifications, reviewTimeline } from '../cases/schema.js';
import { Clock, nairobiDate } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import {
  CLARIFICATION_MISSING,
  type ClarificationClock,
  type ClarificationWorkflowInput,
  LETTER_REFUSED,
  type LetterOutcome,
  type NotifyOutcome,
  type NotifyRequest,
} from './contract.js';
import {
  CLARIFICATION_OVERDUE,
  CLARIFICATION_REMINDER_SENT,
  type ClarificationEventData,
} from './events.js';
import { portalClarificationUrl } from './links.js';

/** Namespace of the messages' idempotency keys: one key per clarification, notice and channel. */
const MESSAGE_KEY_NAMESPACE = '5d0f3c8e-4a61-4f3e-9b4c-6f1d2a7e8c90';

/** The template version of `clarification-letter` this service's payload fills. */
export const CLARIFICATION_LETTER_TEMPLATE_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The activities of `ClarificationWorkflow`, hosted by the review worker. Every public method is
 * an activity named after it (keep helpers out of this class); each is safe to retry. An
 * unreachable documents, notifications or directory service propagates, so Temporal retries.
 */
@Injectable()
export class ClarificationActivities {
  private readonly logger = new Logger(ClarificationActivities.name);

  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Asks documents to issue the Restricted clarification letter (ADR-010), once: the letter's
   * document and verification ids are kept on the clarification. The request names the
   * clarification only; documents pulls the template fields from the letter payload endpoint.
   * A clarification withdrawn before its letter was asked for gets none; a letter that raced a
   * withdrawal is revoked as issued in error as soon as it is kept.
   */
  async requestLetter({
    tenant,
    clarificationId,
  }: ClarificationWorkflowInput): Promise<LetterOutcome> {
    const found = await load(this.db, tenant, clarificationId);
    if (found.status === 'draft') return 'not-issued';
    if (found.letterDocumentId !== null) return 'already-requested';
    if (found.status === 'withdrawn') return 'withdrawn';
    if (found.reference === null || found.issuedAt === null) {
      throw new Error(`Clarification ${clarificationId} is issued without a reference`);
    }
    let issued;
    try {
      issued = await this.documents.issue(
        {
          type: 'clarification-letter',
          templateVersion: CLARIFICATION_LETTER_TEMPLATE_VERSION,
          subjectRef: `clarification:${clarificationId}`,
          subjectPersonId: found.personId,
          payload: { clarificationId },
        },
        tenant,
      );
    } catch (error) {
      if (error instanceof InternalApiRejected) {
        throw ApplicationFailure.nonRetryable(
          `Documents refused the letter of ${clarificationId} (${String(error.status)})`,
          LETTER_REFUSED,
        );
      }
      throw error;
    }
    const [kept] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .update(clarifications)
        .set({ letterDocumentId: issued.id, letterVerificationId: issued.verificationId })
        .where(and(eq(clarifications.id, clarificationId), isNull(clarifications.letterDocumentId)))
        .returning({ status: clarifications.status }),
    );
    // Withdrawn while documents rendered the letter: the withdrawal found no letter to revoke.
    if (kept?.status === 'withdrawn') {
      await this.documents.revoke(issued.id, tenant, 'issued-in-error');
      return 'withdrawn';
    }
    return 'requested';
  }

  /**
   * Tells the declarant, by person, on one channel. The same notice on the same channel always
   * carries the same idempotency key, so a retry is not delivered twice. A message notifications
   * refuses is not retried: sending it again would be refused again. The reminder goes only to a
   * declarant who still has to answer (status `issued`), with the days left.
   */
  async notifyDeclarant({
    tenant,
    clarificationId,
    notice,
    channel,
  }: NotifyRequest): Promise<NotifyOutcome> {
    const found = await load(this.db, tenant, clarificationId);
    if (found.reference === null || found.dueAt === null) {
      throw new Error(`Clarification ${clarificationId} is not issued`);
    }
    if (notice === 'reminder' && found.status !== 'issued') return 'skipped';
    const commission = await this.directory.getCommission(tenant);
    const template = `clarification-${notice}-${channel}` as const;
    const params: Record<string, string | number> = {
      commission: commission.name,
      reference: found.reference,
      dueDate: nairobiDate(found.dueAt),
      portalUrl: portalClarificationUrl(clarificationId),
    };
    if (notice === 'reminder') {
      params.daysLeft = Math.max(
        0,
        Math.ceil((found.dueAt.getTime() - this.clock.now().getTime()) / DAY_MS),
      );
    }
    try {
      const sent = await this.notifications.send({
        channel,
        personId: found.personId,
        template,
        params,
        tenant,
        idempotencyKey: uuidv5(`${clarificationId}:${template}`, MESSAGE_KEY_NAMESPACE),
      });
      return sent.status;
    } catch (error) {
      if (!(error instanceof InternalApiRejected)) throw error;
      this.logger.warn(
        { clarificationId, template, status: error.status },
        'Notifications refused a clarification message',
      );
      return 'rejected';
    }
  }

  /**
   * What the workflow sets its clock from: the issue time and the due date stored at issue (from
   * the reply window of the Commission's policy then). A later policy change moves neither.
   */
  async clarificationClock({
    tenant,
    clarificationId,
  }: ClarificationWorkflowInput): Promise<ClarificationClock> {
    const found = await load(this.db, tenant, clarificationId);
    if (found.issuedAt === null || found.dueAt === null) {
      throw new Error(`Clarification ${clarificationId} is not issued`);
    }
    return { issuedAt: found.issuedAt.toISOString(), dueAt: found.dueAt.toISOString() };
  }

  /**
   * Records the reminder in the timeline and `clarification.reminder-sent.v1`, once: a retry or a
   * repeated run finds the entry and records nothing. Nothing is recorded for a clarification no
   * longer awaiting the declarant, as no reminder was sent.
   */
  async recordReminder({ tenant, clarificationId }: ClarificationWorkflowInput): Promise<boolean> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [found] = await tx
        .select()
        .from(clarifications)
        .where(eq(clarifications.id, clarificationId))
        .for('update');
      if (found?.status !== 'issued') return false;
      const [recorded] = await tx
        .select({ id: reviewTimeline.id })
        .from(reviewTimeline)
        .where(
          and(
            eq(reviewTimeline.kind, 'clarification-reminder-sent'),
            eq(reviewTimeline.ref, clarificationId),
          ),
        );
      if (recorded) return false;
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: found.caseId,
        kind: 'clarification-reminder-sent',
        ref: clarificationId,
        actor: SYSTEM_SUBJECT,
        summary: `Reminder sent for clarification ${found.reference ?? clarificationId}`,
      });
      await this.events.record<ClarificationEventData>(tx, {
        type: CLARIFICATION_REMINDER_SENT,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: found.caseId },
      });
      return true;
    });
  }

  /**
   * At the due date: a clarification still `issued` becomes `overdue`, with the timeline entry and
   * `clarification.overdue.v1` (spec 08 escalates). One answered, resolved or withdrawn in the
   * meantime, or already overdue, is left as it is.
   */
  async markOverdue({ tenant, clarificationId }: ClarificationWorkflowInput): Promise<boolean> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [overdue] = await tx
        .update(clarifications)
        .set({ status: 'overdue' })
        .where(and(eq(clarifications.id, clarificationId), eq(clarifications.status, 'issued')))
        .returning();
      if (!overdue) return false;
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: overdue.caseId,
        kind: 'clarification-overdue',
        ref: clarificationId,
        actor: SYSTEM_SUBJECT,
        summary: `Clarification ${overdue.reference ?? clarificationId} is overdue`,
      });
      await this.events.record<ClarificationEventData>(tx, {
        type: CLARIFICATION_OVERDUE,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: overdue.caseId },
      });
      return true;
    });
  }
}

/** The clarification, read as the service; one that does not exist fails without retry. */
async function load(db: Database<ReviewSchema>, tenant: string, clarificationId: string) {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx.select().from(clarifications).where(eq(clarifications.id, clarificationId)),
  );
  if (!found) {
    throw ApplicationFailure.nonRetryable(
      `Clarification ${clarificationId} does not exist`,
      CLARIFICATION_MISSING,
    );
  }
  return found;
}
