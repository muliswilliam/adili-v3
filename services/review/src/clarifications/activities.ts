import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { ApplicationFailure } from '@temporalio/common';
import { and, eq, isNull } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { clarifications } from '../cases/schema.js';
import { nairobiDate } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { systemContext } from '../system-context.js';
import {
  CLARIFICATION_MISSING,
  type ClarificationWorkflowInput,
  LETTER_REFUSED,
  type LetterOutcome,
  type NotifyOutcome,
  type NotifyRequest,
} from './contract.js';
import { portalClarificationUrl } from './links.js';

/** Namespace of the messages' idempotency keys: one key per clarification, notice and channel. */
const MESSAGE_KEY_NAMESPACE = '5d0f3c8e-4a61-4f3e-9b4c-6f1d2a7e8c90';

/** The template version of `clarification-letter` this service's payload fills. */
export const CLARIFICATION_LETTER_TEMPLATE_VERSION = 1;

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
  ) {}

  /**
   * Asks documents to issue the Restricted clarification letter (ADR-010), once: the letter's
   * document and verification ids are kept on the clarification. The request names the
   * clarification only; documents pulls the template fields from the letter payload endpoint.
   */
  async requestLetter({
    tenant,
    clarificationId,
  }: ClarificationWorkflowInput): Promise<LetterOutcome> {
    const found = await load(this.db, tenant, clarificationId);
    if (found.status === 'draft') return 'not-issued';
    if (found.letterDocumentId !== null) return 'already-requested';
    if (found.reference === null || found.issuedAt === null) {
      throw new Error(`Clarification ${clarificationId} is issued without a reference`);
    }
    const commission = await this.directory.getCommission(tenant);
    let issued;
    try {
      issued = await this.documents.issue({
        type: 'clarification-letter',
        templateVersion: CLARIFICATION_LETTER_TEMPLATE_VERSION,
        disclosureLevel: 'restricted',
        issuerTenant: tenant,
        subjectRef: `clarification:${clarificationId}`,
        subjectPersonId: found.personId,
        payload: { clarificationId },
        publicPayload: {
          reference: found.reference,
          type: 'clarification-letter',
          issuer: commission.name,
          issuedAt: found.issuedAt.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof InternalApiRejected) {
        throw ApplicationFailure.nonRetryable(
          `Documents refused the letter of ${clarificationId} (${String(error.status)})`,
          LETTER_REFUSED,
        );
      }
      throw error;
    }
    await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .update(clarifications)
        .set({ letterDocumentId: issued.id, letterVerificationId: issued.verificationId })
        .where(
          and(eq(clarifications.id, clarificationId), isNull(clarifications.letterDocumentId)),
        ),
    );
    return 'requested';
  }

  /**
   * Tells the declarant, by person, on one channel. The same notice on the same channel always
   * carries the same idempotency key, so a retry is not delivered twice. A message notifications
   * refuses is not retried: sending it again would be refused again.
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
    const commission = await this.directory.getCommission(tenant);
    const template = `clarification-${notice}-${channel}` as const;
    try {
      const sent = await this.notifications.send({
        channel,
        personId: found.personId,
        template,
        params: {
          commission: commission.name,
          reference: found.reference,
          dueDate: nairobiDate(found.dueAt),
          portalUrl: portalClarificationUrl(clarificationId),
        },
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
