import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { ApplicationFailure } from '@temporalio/common';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { portal } from '../clarifications/links.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { systemContext } from '../system-context.js';
import {
  type DecisionChannel,
  type DecisionLetterOutcome,
  type DecisionNotice,
  type DecisionNoticeOutcome,
  DETERMINATION_MISSING,
  type DeterminationIssuanceInput,
} from './contract.js';
import { issueDecisionLetter } from './decision-letter.js';
import { OUTCOME_LABELS } from './representation.js';
import { determinations } from './schema.js';

/** Namespace of the messages' idempotency keys: one key per determination and channel. */
const MESSAGE_KEY_NAMESPACE = '9b3f7c2a-1d84-4e6b-8f5a-2c7e9d0b4a61';

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
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
  ) {}

  /**
   * Asks documents to issue the Restricted decision letter (ADR-010), once: the letter's document
   * and verification ids are kept on the determination (`issueDecisionLetter`).
   */
  async requestDecisionLetter({
    tenant,
    determinationId,
  }: DeterminationIssuanceInput): Promise<DecisionLetterOutcome> {
    const letter = await issueDecisionLetter(
      { db: this.db, directory: this.directory, documents: this.documents },
      tenant,
      determinationId,
    );
    switch (letter.status) {
      case 'missing':
        throw ApplicationFailure.nonRetryable(
          `Determination ${determinationId} does not exist`,
          DETERMINATION_MISSING,
        );
      case 'not-approved':
        return 'not-approved';
      case 'existing':
        return 'already-requested';
      case 'issued':
        return 'requested';
    }
  }

  /** Tells the declarant of the decision, by person, on one channel (`sendDecisionNotice`). */
  async notifyDecision({
    tenant,
    determinationId,
    channel,
  }: DecisionNotice): Promise<DecisionNoticeOutcome> {
    const found = await load(this.db, tenant, determinationId);
    const commission = await this.directory.getCommission(tenant);
    return sendDecisionNotice(this.notifications, found, commission.name, channel);
  }
}

type DeterminationRow = typeof determinations.$inferSelect;

const noticeLogger = new Logger('DecisionNotices');

/**
 * Tells the declarant of an approved determination's decision, by person, on one channel. The
 * same channel always carries the same idempotency key, so a retry is not delivered twice. A
 * message notifications refuses is not retried: sending it again would be refused again. Bulk
 * closures' notices send theirs the same way.
 */
export async function sendDecisionNotice(
  notifications: NotificationsClient,
  determination: DeterminationRow,
  commissionName: string,
  channel: DecisionChannel,
): Promise<DecisionNoticeOutcome> {
  const { id, tenant, reference } = determination;
  if (reference === null) throw new Error(`Determination ${id} is not approved`);
  const template = `decision-${channel}` as const;
  try {
    const sent = await notifications.send({
      channel,
      personId: determination.personId,
      template,
      params: {
        commission: commissionName,
        reference,
        outcome: OUTCOME_LABELS[determination.outcome],
        portalUrl: portalDecisionUrl(id),
      },
      tenant,
      idempotencyKey: uuidv5(`${id}:${template}`, MESSAGE_KEY_NAMESPACE),
    });
    return sent.status;
  } catch (error) {
    if (!(error instanceof InternalApiRejected)) throw error;
    noticeLogger.warn(
      { determinationId: id, template, status: error.status },
      'Notifications refused a decision message',
    );
    return 'rejected';
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
