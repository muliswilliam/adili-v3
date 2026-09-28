import { type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import createClient, { type Client } from 'openapi-fetch';

import type { components, paths } from './notifications-api.gen.js';
import { OtpDelivery, OtpDeliveryFailed, type OtpMessage } from './otp-delivery.js';

/** The scope the directory's service token needs for the notifications internal API. */
export const NOTIFICATIONS_MESSAGES_SCOPE = 'messages';

type SendMessage = components['schemas']['SendMessage'];

/** The notifications template and channel of each onboarding channel. */
const TEMPLATES = {
  email: { channel: 'email', template: 'onboarding-otp-email' },
  phone: { channel: 'sms', template: 'onboarding-otp-sms' },
} as const satisfies Record<
  OtpMessage['channel'],
  { channel: SendMessage['channel']; template: SendMessage['template'] }
>;

/** The longest Commission name the templates take. */
const COMMISSION_NAME_MAX = 120;

export interface NotificationsOtpDeliveryOptions {
  /** Base URL of the notifications service, e.g. `http://localhost:4010`. */
  notificationsUrl: string;
  /** Client credentials tokens of the directory carrying `messages`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Per call. Default 8 s: notifications gives its provider 5 s, and the declarant waits on the
   * answer.
   */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * Sends onboarding codes through the notifications service's internal messages API
 * (`POST /internal/v1/messages`, templates `onboarding-otp-email` and `onboarding-otp-sms`),
 * with the client generated from its contract (packages/schemas/internal/notifications.yaml →
 * notifications-api.gen.ts via `pnpm generate:api`) and the directory's own token (client
 * credentials, `messages`).
 *
 * Only a message notifications reports `sent` counts as sent. A `failed` message (the provider
 * refused or timed out), any other answer, no answer in time and no token all throw
 * `OtpDeliveryFailed`, so the step rolls back and the declarant may try again.
 */
export class NotificationsOtpDelivery extends OtpDelivery {
  private readonly notifications: Client<paths>;

  constructor(private readonly options: NotificationsOtpDeliveryOptions) {
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

  async send(message: OtpMessage): Promise<void> {
    const { channel, template } = TEMPLATES[message.channel];
    const body: SendMessage = {
      channel,
      recipient: { kind: 'address', to: message.to },
      template,
      params: {
        code: message.code,
        commissionName: message.commissionName.slice(0, COMMISSION_NAME_MAX),
        expiresInMinutes: message.expiresInMinutes,
      },
      locale: 'en',
      tenant: message.tenant,
    };

    let answer = await this.post(body);
    if (answer.response.status === 401) {
      this.options.tokens.invalidate();
      answer = await this.post(body);
    }
    const { data, response } = answer;
    if (response.status !== 201 || !data) {
      throw new OtpDeliveryFailed(`notifications answered ${String(response.status)}`);
    }
    if (data.status !== 'sent') {
      throw new OtpDeliveryFailed(`notifications reported the message ${data.status}`);
    }
  }

  private async post(body: SendMessage) {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new OtpDeliveryFailed('no service token for the notifications service', {
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
      throw new OtpDeliveryFailed('the notifications service is unreachable', { cause: error });
    }
  }
}
