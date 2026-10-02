import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { rejectedBy } from '../internal-api/rejected.js';
import type { paths } from './notifications-api.gen.js';
import {
  NotificationsClient,
  NotificationsUnavailable,
  type PersonMessage,
  type SentMessage,
} from './notifications-client.js';

/**
 * Notifications answers within its 5-second provider budget; the rest covers the hop. Messages go
 * out from workflow activities, which retry. Recorded in ADR-013 §2 (synchronous budgets).
 */
export const MESSAGES_TIMEOUT_MS = 7_000;

export interface HttpNotificationsClientOptions {
  notificationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The templates notifications' contract lists. */
type MessageTemplate =
  paths['/internal/v1/messages']['post']['requestBody']['content']['application/json']['template'];

const messageSchema = z.object({
  id: z.uuid(),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullish(),
});

/**
 * `POST /internal/v1/messages` through the client generated from the notifications contract
 * (notifications-api.gen.ts) with the review service's own token (`messages`). The tenant travels
 * in the body, as the contract asks; no `X-Acting-Tenant`. A message notifications refuses (400,
 * 422) is `InternalApiRejected`; anything else unexpected is `NotificationsUnavailable`.
 */
export class HttpNotificationsClient extends NotificationsClient {
  private readonly notifications: ServiceClient<paths>;

  constructor(options: HttpNotificationsClientOptions) {
    super();
    this.notifications = createServiceClient<paths>({
      baseUrl: options.notificationsUrl,
      service: 'notifications',
      tokens: options.tokens,
      unavailable: (message, cause) => new NotificationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? MESSAGES_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async send(message: PersonMessage): Promise<SentMessage> {
    const sent = await this.notifications.call(
      (api) =>
        api.POST('/internal/v1/messages', {
          params: { header: { 'Idempotency-Key': message.idempotencyKey } },
          body: {
            channel: message.channel,
            recipient: { kind: 'person', personId: message.personId },
            // The clarification templates are in notifications' contract; the decision, notice
            // and salary ones (spec 08) join it later, and until then notifications refuses them
            // with 400 (InternalApiRejected), which the activities do not retry.
            template: message.template as MessageTemplate,
            params: message.params,
            locale: 'en',
            tenant: message.tenant,
          },
        }),
      {
        status: 201,
        schema: messageSchema,
        otherwise: { 400: rejectedBy('notifications'), 422: rejectedBy('notifications') },
      },
    );
    return { id: sent.id, status: sent.status, error: sent.error ?? null };
  }
}
