import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { components, paths } from './notifications-api.gen.js';
import {
  NotificationsClient,
  NotificationsRejected,
  NotificationsUnavailable,
  type ReminderChannel,
  type ReminderMessage,
  type SendOutcome,
} from './notifications-client.js';

/** The scope the declarations service's token needs for the notifications messages API. */
export const NOTIFICATIONS_MESSAGES_SCOPE = 'messages';

/**
 * How long a reminder waits for notifications: its synchronous budget for the contact lookup and
 * the provider (5 s, spec 03 and 04) plus the hop. A recorded exception to ADR-013's 2 s default;
 * the reminder activity retries, with the same Idempotency-Key, what gets no answer in time.
 */
export const NOTIFICATIONS_SEND_TIMEOUT_MS = 8_000;

type SendMessage = components['schemas']['SendMessage'];

const TEMPLATES = {
  sms: 'obligation-reminder-sms',
  email: 'obligation-reminder-email',
} as const satisfies Record<ReminderChannel, SendMessage['template']>;

/** What the reminder reads of notifications' `Message`, validated at the boundary. */
const messageSchema = z.object({
  id: z.uuid(),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullable(),
});

export interface HttpNotificationsClientOptions {
  /** Base URL of the notifications service, e.g. `http://localhost:4010`. */
  notificationsUrl: string;
  /** Client credentials tokens of the declarations service carrying `messages`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `NOTIFICATIONS_SEND_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * `POST /internal/v1/messages` with recipient `{ kind: 'person', personId }` through the client
 * generated from the notifications contract (packages/schemas/internal/notifications.yaml →
 * notifications-api.gen.ts via `pnpm generate:api`) on api-kit's service client (the service's
 * own token with `messages`, one retry after a 401), with the reminder channel's
 * `Idempotency-Key`, so a retried request never sends a second message.
 *
 * A 400 (or a key reused for another body, 422) is `NotificationsRejected`: the same request
 * cannot succeed. Anything else unexpected, including 409 (the first request with the key still
 * running), is `NotificationsUnavailable`: retry later.
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

  async sendReminder(message: ReminderMessage): Promise<SendOutcome> {
    const body: SendMessage = {
      channel: message.channel,
      recipient: { kind: 'person', personId: message.personId },
      template: TEMPLATES[message.channel],
      params: { ...message.params },
      locale: 'en',
      tenant: message.tenant,
    };
    const rejected = () => {
      throw new NotificationsRejected(`notifications refused the ${message.channel} reminder`);
    };
    const sent = await this.notifications.call(
      (api) =>
        api.POST('/internal/v1/messages', {
          body,
          params: { header: { 'Idempotency-Key': message.idempotencyKey } },
        }),
      { status: 201, schema: messageSchema, otherwise: { 400: rejected, 422: rejected } },
    );
    return sent.status === 'sent'
      ? { status: 'sent', messageId: sent.id }
      : { status: 'failed', error: sent.error ?? 'provider-error' };
  }
}
