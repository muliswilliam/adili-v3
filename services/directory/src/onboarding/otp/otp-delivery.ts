import type { ContactChannel } from '@adili/contacts';

/** One one-time code to send: through the notifications service's onboarding OTP templates. */
export interface OtpMessage {
  channel: ContactChannel;
  /** The email address, or the phone number in E.164. */
  to: string;
  code: string;
  /** The Commission the declarant onboards with, named in the message. */
  commissionName: string;
  expiresInMinutes: number;
  /** The Commission's slug, for the message record. */
  tenant: string;
}

/** The code could not be sent; nothing about the session changes (the caller rolls back). */
export class OtpDeliveryFailed extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`One-time code not sent: ${reason}`, options);
    this.name = 'OtpDeliveryFailed';
  }
}

/**
 * Sends onboarding one-time codes (a Nest token): `NotificationsOtpDelivery` in the service,
 * `InMemoryOtpDelivery` in tests. Implementations throw
 * `OtpDeliveryFailed` when the message was not sent (notifications answered `failed`, or did not
 * answer).
 */
export abstract class OtpDelivery {
  abstract send(message: OtpMessage): Promise<void>;
}
