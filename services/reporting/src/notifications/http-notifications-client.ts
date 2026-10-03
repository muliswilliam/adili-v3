import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './notifications-api.gen.js';
import {
  NotificationsClient,
  NotificationsUnavailable,
  type SentMessage,
  type StaffEmail,
} from './notifications-client.js';

/** The scope the reporting service's token needs for notifications' messages API. */
export const MESSAGES_SCOPE = 'messages';

/**
 * Notifications answers within its 5 s budget for the provider; the extra time covers the hop.
 * Recorded in ADR-013 §2; sends run in workflow activities, which retry with the same
 * Idempotency-Key, so a message is never sent twice.
 */
export const NOTIFICATIONS_SEND_TIMEOUT_MS = 7_000;

export interface HttpNotificationsClientOptions {
  notificationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `NOTIFICATIONS_SEND_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const messageSchema = z.object({
  id: z.uuid(),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullish(),
});

/**
 * Notifications' `sendMessage` through the client generated from its contract
 * (packages/schemas/internal/notifications.yaml → notifications-api.gen.ts via
 * `pnpm generate:api`), with the reporting service's own token (`messages`).
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
      timeoutMs: options.timeoutMs ?? NOTIFICATIONS_SEND_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async send(message: StaffEmail): Promise<SentMessage> {
    const sent = await this.notifications.call(
      (api) =>
        api.POST('/internal/v1/messages', {
          params: { header: { 'Idempotency-Key': message.idempotencyKey } },
          body: {
            channel: 'email',
            recipient: { kind: 'address', to: message.to },
            template: message.template,
            params: message.params,
            locale: 'en',
            tenant: message.tenant,
          },
        }),
      {
        status: 201,
        schema: messageSchema,
        otherwise: refusedWith('notifications', [400, 403, 422]),
      },
    );
    return { id: sent.id, status: sent.status, error: sent.error ?? null };
  }
}
