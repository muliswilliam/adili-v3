import type { Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import type { AccessDatabase } from '../db/database.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import type { AccessMessage, NotificationsClient } from '../notifications/notifications-client.js';
import { systemContext } from '../system-context.js';
import type { AccessRequestRow } from './representation.js';
import { accessRequests } from './schema.js';

/** What `AccessRequestWorkflow`'s activities share: reading the request, sending its messages. */

/** Namespace of the workflow's messages' idempotency keys (UUID v5). */
const MESSAGE_KEY_NAMESPACE = '9a4c2e71-5b3d-4f86-a0e9-7c1d3b5f2a64';

/** Applicants and declarants are told by email and SMS. */
export const CHANNELS = ['email', 'sms'] as const;

/** The request, in its Commission's context; undefined when it is not there. */
export async function load(
  db: AccessDatabase,
  tenant: string,
  requestId: string,
): Promise<AccessRequestRow | undefined> {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx.select().from(accessRequests).where(eq(accessRequests.id, requestId)),
  );
  return found;
}

/** Sends one message; refused or undeliverable is logged, not retried. */
export async function send(
  notifications: NotificationsClient,
  logger: Logger,
  request: AccessRequestRow,
  message: AccessMessage,
): Promise<void> {
  const context = { requestId: request.id, template: message.template };
  try {
    const sent = await notifications.send(message);
    if (sent.status === 'failed') {
      logger.warn({ ...context, reason: sent.error }, 'Access message not delivered');
    }
  } catch (error) {
    if (!(error instanceof InternalApiRejected)) throw error;
    logger.error({ ...context, err: errorType(error) }, 'Access message refused by notifications');
  }
}

/** The same message of the same request always carries the same key, so it is sent once. */
export function messageKey(requestId: string, message: string): string {
  return uuidv5(`${requestId}:${message}`, MESSAGE_KEY_NAMESPACE);
}
