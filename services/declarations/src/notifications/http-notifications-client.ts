import { type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import createClient, { type Client } from 'openapi-fetch';

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

type SendMessage = components['schemas']['SendMessage'];

const TEMPLATES = {
  sms: 'obligation-reminder-sms',
  email: 'obligation-reminder-email',
} as const satisfies Record<ReminderChannel, SendMessage['template']>;

export interface HttpNotificationsClientOptions {
  /** Base URL of the notifications service, e.g. `http://localhost:4010`. */
  notificationsUrl: string;
  /** Client credentials tokens of the declarations service carrying `messages`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per call. Default 8 s: notifications gives its provider 5 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * `POST /internal/v1/messages` with recipient `{ kind: 'person', personId }` through the client
 * generated from the notifications contract (packages/schemas/internal/notifications.yaml →
 * notifications-api.gen.ts via `pnpm generate:api`), with the service's own token (client
 * credentials, `messages`). A 401 is retried once with a fresh token.
 */
export class HttpNotificationsClient extends NotificationsClient {
  private readonly notifications: Client<paths>;

  constructor(private readonly options: HttpNotificationsClientOptions) {
    super();
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 8_000;
    this.notifications = createClient<paths>({
      baseUrl: options.notificationsUrl.replace(/\/$/, ''),
      headers: { accept: 'application/json' },
      fetch: (request) =>
        fetchImpl(new Request(request, { signal: AbortSignal.timeout(timeoutMs) })),
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
    let answer = await this.post(body);
    if (answer.response.status === 401) {
      this.options.tokens.invalidate();
      answer = await this.post(body);
    }
    const { data, response } = answer;
    if (response.status === 400) {
      throw new NotificationsRejected(`notifications refused the ${message.channel} reminder`);
    }
    if (response.status !== 201 || !data) {
      throw new NotificationsUnavailable(`notifications answered ${String(response.status)}`);
    }
    return data.status === 'sent'
      ? { status: 'sent', messageId: data.id }
      : { status: 'failed', error: data.error ?? 'provider-error' };
  }

  private async post(body: SendMessage) {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new NotificationsUnavailable('no service token for the notifications service', {
          cause: error,
        });
      }
      throw error;
    }
    try {
      return await this.notifications.POST('/internal/v1/messages', {
        body,
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw new NotificationsUnavailable('the notifications service is unreachable', {
        cause: error,
      });
    }
  }
}
