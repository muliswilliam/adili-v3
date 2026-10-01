import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './notifications-api.gen.js';
import {
  type AccessMessage,
  NotificationsClient,
  NotificationsUnavailable,
  type SentMessage,
} from './notifications-client.js';

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

/**
 * The send body as notifications' contract declares it. The access templates join its
 * `TemplateId` when notifications renders them (#258); until then they are sent by name.
 */
type SendMessageBody =
  paths['/internal/v1/messages']['post']['requestBody']['content']['application/json'];

const messageSchema = z.object({
  id: z.uuid(),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullish(),
});

/**
 * Notifications' `sendMessage` through the client generated from its contract
 * (packages/schemas/internal/notifications.yaml → notifications-api.gen.ts via
 * `pnpm generate:api`), with the access service's own token (`messages`).
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

  async send(message: AccessMessage): Promise<SentMessage> {
    const { idempotencyKey, ...body } = message;
    const sent = await this.notifications.call(
      (api) =>
        api.POST('/internal/v1/messages', {
          params: { header: { 'Idempotency-Key': idempotencyKey } },
          body: { ...body, locale: 'en' } as unknown as SendMessageBody,
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
