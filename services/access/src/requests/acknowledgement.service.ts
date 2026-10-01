import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { DATABASE, withTenant } from '@adili/data-access';
import { consumeIdempotent, type EventEnvelope } from '@adili/events';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { nairobiDate } from '../clock.js';
import type { AccessDatabase } from '../db/database.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { type AccessTemplate, NotificationsClient } from '../notifications/notifications-client.js';
import { systemContext } from '../system-context.js';
import { applicantRequestsUrl } from './links.js';
import type { AccessRequestRow } from './representation.js';
import { accessRequests } from './schema.js';

/** Inbox consumer of the acknowledgement messages. */
const ACKNOWLEDGED_CONSUMER = 'access.acknowledgement-sent';

/** Namespace of the acknowledgement messages' idempotency keys (UUID v5). */
const ACKNOWLEDGEMENT_KEY_NAMESPACE = '3b7e9d14-2c6a-4f80-b5d1-8e4a6c2f0b97';

const TEMPLATES: Record<'email' | 'sms', AccessTemplate> = {
  email: 'access-acknowledgement-email',
  sms: 'access-acknowledgement-sms',
};

/** What the acknowledgement reads of `access.request.received.v1`. */
export interface ReceivedRequest {
  subjectKind: string;
  subjectId: string;
  tenant: string;
}

/**
 * The acknowledgement of a Form K (spec 10, S2; Regs r.22): once a request is received, its
 * applicant is told by email and SMS, with its `ARQ` reference, the Commission and the decision
 * deadline (and, for a passport applicant, that the request waits for their identity to be
 * checked). Driven by the request's own `access.request.received.v1`, written in the transaction
 * that stored it: the acknowledgement goes out however the submission ended.
 */
@Injectable()
export class AcknowledgementService {
  private readonly logger = new Logger(AcknowledgementService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly notifications: NotificationsClient,
  ) {}

  /**
   * Sends both messages to the applicant (a person recipient: notifications reads their contacts
   * from the directory). The messages go out with no transaction open (ADR-013); each keeps an
   * `Idempotency-Key` per request and channel, so a redelivery sends nothing twice. Notifications
   * unreachable throws, and the event is retried; a message refused or not deliverable (no
   * contact) is logged, not retried.
   */
  async received(event: EventEnvelope, data: ReceivedRequest): Promise<void> {
    if (data.subjectKind !== 'access-request') return;
    await consumeIdempotent(this.db, ACKNOWLEDGED_CONSUMER, event, async () => {
      const row = await withTenant(this.db, systemContext(data.tenant), async (tx) => {
        const [found] = await tx
          .select()
          .from(accessRequests)
          .where(eq(accessRequests.id, data.subjectId));
        return found;
      });
      if (!row) {
        this.logger.warn({ requestId: data.subjectId }, 'Acknowledgement of an unknown request');
        return;
      }
      for (const channel of ['email', 'sms'] as const) {
        await this.send(row, channel);
      }
    });
  }

  private async send(row: AccessRequestRow, channel: 'email' | 'sms'): Promise<void> {
    try {
      const sent = await this.notifications.send({
        channel,
        recipient: { kind: 'person', personId: row.applicantPersonId },
        template: TEMPLATES[channel],
        params: {
          reference: row.reference,
          commissionName: row.commissionName,
          decideBy: nairobiDate(row.decisionDeadlineAt),
          identityStatus: row.applicantIdentityStatus,
          signInUrl: applicantRequestsUrl(),
        },
        tenant: row.tenant,
        idempotencyKey: uuidv5(
          `${row.id}:acknowledgement:${channel}`,
          ACKNOWLEDGEMENT_KEY_NAMESPACE,
        ),
      });
      if (sent.status === 'failed') {
        this.logger.warn(
          { requestId: row.id, channel, reason: sent.error },
          'Acknowledgement not sent',
        );
      }
    } catch (error) {
      if (error instanceof InternalApiRejected) {
        this.logger.error(
          { requestId: row.id, channel, err: errorType(error) },
          'Acknowledgement refused by notifications',
        );
        return;
      }
      throw error;
    }
  }
}
