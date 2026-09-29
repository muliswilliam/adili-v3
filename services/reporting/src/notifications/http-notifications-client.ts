import { IDEMPOTENCY_KEY_HEADER, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  NotificationsClient,
  NotificationsUnavailable,
  type SentMessage,
  type StaffEmail,
} from './notifications-client.js';

/** The scope the reporting service's token needs for notifications' messages API. */
export const MESSAGES_SCOPE = 'messages';

export interface HttpNotificationsClientOptions {
  notificationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
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
 * `POST /internal/v1/messages` with the reporting service's own token (`messages`).
 * Notifications answers within its 5-second budget.
 */
export class HttpNotificationsClient extends NotificationsClient {
  private readonly api: InternalApi;

  constructor(options: HttpNotificationsClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.notificationsUrl,
      service: 'notifications',
      tokens: options.tokens,
      unavailable: (message, cause) => new NotificationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? 7_000,
      fetch: options.fetch,
    });
  }

  async send(message: StaffEmail): Promise<SentMessage> {
    const sent = await this.api.post({
      path: 'internal/v1/messages',
      tenant: message.tenant,
      headers: { [IDEMPOTENCY_KEY_HEADER]: message.idempotencyKey },
      body: {
        channel: 'email',
        recipient: { kind: 'address', to: message.to },
        template: message.template,
        params: message.params,
        tenant: message.tenant,
      },
      schema: messageSchema,
    });
    if (!sent) throw new NotificationsUnavailable('The notifications service answered 404');
    return { id: sent.id, status: sent.status, error: sent.error ?? null };
  }
}
