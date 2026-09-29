import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { ApplicationFailure } from '@temporalio/common';
import { and, eq, isNull } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { portal } from '../clarifications/links.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { systemContext } from '../system-context.js';
import {
  DECISION_LETTER_REFUSED,
  type DecisionLetterOutcome,
  type DecisionNotice,
  type DecisionNoticeOutcome,
  DETERMINATION_MISSING,
  type DeterminationIssuanceInput,
} from './contract.js';
import { OUTCOME_LABELS } from './representation.js';
import { determinations } from './schema.js';

/** Namespace of the messages' idempotency keys: one key per determination and channel. */
const MESSAGE_KEY_NAMESPACE = '9b3f7c2a-1d84-4e6b-8f5a-2c7e9d0b4a61';

/** The template version of `decision-letter` this service's payload fills. */
export const DECISION_LETTER_TEMPLATE_VERSION = 1;

/** The portal page where the declarant sees a decision. */
export function portalDecisionUrl(determinationId: string): string {
  return portal(`decisions/${determinationId}`);
}

/**
 * The activities of `DeterminationIssuanceWorkflow`, hosted by the review worker. Every public
 * method is an activity named after it (keep helpers out of this class); each is safe to retry. An
 * unreachable documents, notifications or directory service propagates, so Temporal retries.
 */
@Injectable()
export class DeterminationActivities {
  private readonly logger = new Logger(DeterminationActivities.name);

  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
  ) {}

  /**
   * Asks documents to issue the Restricted decision letter (ADR-010), once: the letter's document
   * and verification ids are kept on the determination. The request names the determination only;
   * documents pulls the template fields from the letter payload endpoint.
   */
  async requestDecisionLetter({
    tenant,
    determinationId,
  }: DeterminationIssuanceInput): Promise<DecisionLetterOutcome> {
    const found = await load(this.db, tenant, determinationId);
    if (found.status !== 'approved') return 'not-approved';
    if (found.letterDocumentId !== null) return 'already-requested';
    if (found.reference === null || found.approvedAt === null) {
      throw new Error(`Determination ${determinationId} is approved without a reference`);
    }
    const commission = await this.directory.getCommission(tenant);
    let issued;
    try {
      issued = await this.documents.issue({
        type: 'decision-letter',
        templateVersion: DECISION_LETTER_TEMPLATE_VERSION,
        disclosureLevel: 'restricted',
        issuerTenant: tenant,
        subjectRef: `determination:${determinationId}`,
        subjectPersonId: found.personId,
        payload: { determinationId },
        publicPayload: {
          reference: found.reference,
          type: 'decision-letter',
          issuer: commission.name,
          issuedAt: found.approvedAt.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof InternalApiRejected) {
        throw ApplicationFailure.nonRetryable(
          `Documents refused the decision letter of ${determinationId} (${String(error.status)})`,
          DECISION_LETTER_REFUSED,
        );
      }
      throw error;
    }
    await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .update(determinations)
        .set({ letterDocumentId: issued.id, letterVerificationId: issued.verificationId })
        .where(
          and(eq(determinations.id, determinationId), isNull(determinations.letterDocumentId)),
        ),
    );
    return 'requested';
  }

  /**
   * Tells the declarant of the decision, by person, on one channel. The same channel always
   * carries the same idempotency key, so a retry is not delivered twice. A message notifications
   * refuses is not retried: sending it again would be refused again.
   */
  async notifyDecision({
    tenant,
    determinationId,
    channel,
  }: DecisionNotice): Promise<DecisionNoticeOutcome> {
    const found = await load(this.db, tenant, determinationId);
    if (found.reference === null) {
      throw new Error(`Determination ${determinationId} is not approved`);
    }
    const commission = await this.directory.getCommission(tenant);
    const template = `decision-${channel}` as const;
    try {
      const sent = await this.notifications.send({
        channel,
        personId: found.personId,
        template,
        params: {
          commission: commission.name,
          reference: found.reference,
          outcome: OUTCOME_LABELS[found.outcome],
          portalUrl: portalDecisionUrl(determinationId),
        },
        tenant,
        idempotencyKey: uuidv5(`${determinationId}:${template}`, MESSAGE_KEY_NAMESPACE),
      });
      return sent.status;
    } catch (error) {
      if (!(error instanceof InternalApiRejected)) throw error;
      this.logger.warn(
        { determinationId, template, status: error.status },
        'Notifications refused a decision message',
      );
      return 'rejected';
    }
  }
}

/** The determination, read as the service; one that does not exist fails without retry. */
async function load(db: Database<ReviewSchema>, tenant: string, determinationId: string) {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx.select().from(determinations).where(eq(determinations.id, determinationId)),
  );
  if (!found) {
    throw ApplicationFailure.nonRetryable(
      `Determination ${determinationId} does not exist`,
      DETERMINATION_MISSING,
    );
  }
  return found;
}
