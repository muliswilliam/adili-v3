import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { components, paths } from './notifications-api.gen.js';
import { OtpDelivery, OtpDeliveryFailed, type OtpMessage } from './otp-delivery.js';

/** The scope the directory's service token needs for the notifications internal API. */
export const NOTIFICATIONS_MESSAGES_SCOPE = 'messages';

/**
 * How long the directory waits for notifications to send a code: notifications' synchronous
 * budget for its provider (5 s, spec 03) plus a second for the hop. The recorded exception to
 * ADR-013's 2 s default.
 */
export const NOTIFICATIONS_SEND_TIMEOUT_MS = 6_000;

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

/** What the directory reads of notifications' `MessageView`, validated at the boundary. */
const messageViewSchema = z.object({ status: z.enum(['sent', 'failed']) });

export interface NotificationsOtpDeliveryOptions {
  /** Base URL of the notifications service, e.g. `http://localhost:4010`. */
  notificationsUrl: string;
  /** Client credentials tokens of the directory carrying `messages`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per call. Default `NOTIFICATIONS_SEND_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * Sends onboarding codes through the notifications service's internal messages API
 * (`POST /internal/v1/messages`, templates `onboarding-otp-email` and `onboarding-otp-sms`),
 * with the client generated from its contract (packages/schemas/internal/notifications.yaml →
 * notifications-api.gen.ts via `pnpm generate:api`) on api-kit's service client (the directory's
 * own token with `messages`, one retry after a 401).
 *
 * Only a message notifications reports `sent` counts as sent. A `failed` message (the provider
 * refused or timed out), any other answer (or one that breaks the contract), no answer in time
 * and no token all throw `OtpDeliveryFailed`, so the step changes nothing and the declarant may
 * try again.
 */
export class NotificationsOtpDelivery extends OtpDelivery {
  private readonly notifications: ServiceClient<paths>;

  constructor(options: NotificationsOtpDeliveryOptions) {
    super();
    this.notifications = createServiceClient<paths>({
      baseUrl: options.notificationsUrl,
      service: 'notifications',
      tokens: options.tokens,
      unavailable: (message, options) => new OtpDeliveryFailed(message, options),
      timeoutMs: options.timeoutMs ?? NOTIFICATIONS_SEND_TIMEOUT_MS,
      fetch: options.fetch,
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

    const sent = await this.notifications.call(
      (api) => api.POST('/internal/v1/messages', { body }),
      { status: 201, schema: messageViewSchema },
    );
    if (sent.status !== 'sent') {
      throw new OtpDeliveryFailed(`notifications reported the message ${sent.status}`);
    }
  }
}
