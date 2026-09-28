import { Injectable } from '@nestjs/common';

import type { OtpChannel } from '../session-state.js';

/** One one-time code to send: through the notifications service's onboarding OTP templates. */
export interface OtpMessage {
  channel: OtpChannel;
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
 * Sends onboarding one-time codes (a Nest token). The notifications-backed adapter comes with
 * the OTP ticket (#70); tests use `InMemoryOtpDelivery`. Implementations throw
 * `OtpDeliveryFailed` when the message was not sent (notifications answered `failed`, or did not
 * answer).
 */
export abstract class OtpDelivery {
  abstract send(message: OtpMessage): Promise<void>;
}

/**
 * Bound until the notifications adapter exists (#70): every send fails, so identify answers 502
 * for records with an email instead of pretending a code went out.
 */
@Injectable()
export class UnconfiguredOtpDelivery extends OtpDelivery {
  send(): Promise<void> {
    return Promise.reject(new OtpDeliveryFailed('no message channel is configured'));
  }
}
