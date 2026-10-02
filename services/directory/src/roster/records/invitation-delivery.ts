import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { components, paths } from '../../onboarding/otp/notifications-api.gen.js';

/** One invitation message to a roster record's contact, through notifications. */
export interface InvitationMessage {
  channel: 'email' | 'sms';
  /** The roster's email address, or phone number in E.164. */
  to: string;
  commissionName: string;
  /** The portal's onboarding start for the Commission. */
  getStartedUrl: string;
  /** The Commission's slug, for the message record. */
  tenant: string;
  /** The same message of the same invitation always carries the same key: sent once. */
  idempotencyKey: string;
}

/** Notifications could not be reached (or answered outside its contract): worth retrying. */
export class InvitationDeliveryUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvitationDeliveryUnavailable';
  }
}

/**
 * Sends invitations to set up a declarant account (a Nest token): `NotificationsInvitationDelivery`
 * in the service, `InMemoryInvitationDelivery` in tests. Resolves to whether notifications sent
 * the message (`failed`: the provider refused it, or the contact is not one it can send to);
 * throws `InvitationDeliveryUnavailable` when notifications cannot be reached.
 */
export abstract class InvitationDelivery {
  abstract send(message: InvitationMessage): Promise<'sent' | 'failed'>;
}

type SendMessage = components['schemas']['SendMessage'];

const TEMPLATES = {
  email: 'onboarding-invitation-email',
  sms: 'onboarding-invitation-sms',
} as const satisfies Record<InvitationMessage['channel'], SendMessage['template']>;

/** The longest Commission name the templates take. */
const COMMISSION_NAME_MAX = 120;

const messageViewSchema = z.object({ status: z.enum(['sent', 'failed']) });

/** Notifications answers within its 5 s provider budget; a second more for the hop. */
const NOTIFICATIONS_SEND_TIMEOUT_MS = 6_000;

export interface NotificationsInvitationDeliveryOptions {
  notificationsUrl: string;
  /** Client credentials tokens of the directory carrying `messages`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** A body notifications refuses: the contact is not one it can send to; retrying changes nothing. */
const refused = () => ({ status: 'failed' as const });

/**
 * Sends invitations through notifications' internal messages API (templates
 * `onboarding-invitation-email` and `onboarding-invitation-sms`) with the directory's own token
 * (`messages`) and an `Idempotency-Key` per message.
 */
export class NotificationsInvitationDelivery extends InvitationDelivery {
  private readonly notifications: ServiceClient<paths>;

  constructor(options: NotificationsInvitationDeliveryOptions) {
    super();
    this.notifications = createServiceClient<paths>({
      baseUrl: options.notificationsUrl,
      service: 'notifications',
      tokens: options.tokens,
      unavailable: (message, cause) => new InvitationDeliveryUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? NOTIFICATIONS_SEND_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async send(message: InvitationMessage): Promise<'sent' | 'failed'> {
    const body: SendMessage = {
      channel: message.channel,
      recipient: { kind: 'address', to: message.to },
      template: TEMPLATES[message.channel],
      params: {
        commissionName: message.commissionName.slice(0, COMMISSION_NAME_MAX),
        getStartedUrl: message.getStartedUrl,
      },
      locale: 'en',
      tenant: message.tenant,
    };
    const sent = await this.notifications.call(
      (api) =>
        api.POST('/internal/v1/messages', {
          params: { header: { 'Idempotency-Key': message.idempotencyKey } },
          body,
        }),
      { status: 201, schema: messageViewSchema, otherwise: { 400: refused, 422: refused } },
    );
    return sent.status;
  }
}

/** `InvitationDelivery` for tests: keeps every message, fails the next sends on request. */
export class InMemoryInvitationDelivery extends InvitationDelivery {
  private readonly messages: InvitationMessage[] = [];
  private unavailable = 0;
  private readonly refusedContacts = new Set<string>();

  async send(message: InvitationMessage): Promise<'sent' | 'failed'> {
    if (this.unavailable > 0) {
      this.unavailable -= 1;
      throw new InvitationDeliveryUnavailable('unavailable on request');
    }
    if (this.refusedContacts.has(message.to)) return 'failed';
    // Notifications sends a message once per key.
    if (!this.messages.some((sent) => sent.idempotencyKey === message.idempotencyKey)) {
      this.messages.push(message);
    }
    return 'sent';
  }

  /** Messages sent, oldest first. */
  sent(): InvitationMessage[] {
    return [...this.messages];
  }

  /** Makes the next `count` sends fail as unreachable. */
  failNext(count = 1): void {
    this.unavailable = count;
  }

  /** Makes every message to `to` come back `failed`. */
  refuse(to: string): void {
    this.refusedContacts.add(to);
  }

  reset(): void {
    this.messages.length = 0;
    this.unavailable = 0;
    this.refusedContacts.clear();
  }
}
