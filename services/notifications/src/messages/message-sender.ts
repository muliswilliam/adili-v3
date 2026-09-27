/** A rendered message ready for a provider. */
export interface OutboundMessage {
  /** Email address or E.164 phone number, already validated for the channel. */
  to: string;
  /** Email only. */
  subject?: string;
  text: string;
  /** Email only. */
  html?: string;
}

export interface Delivery {
  providerMessageId: string;
}

/** Why a provider did not accept a message. Stored as the message's `error`. */
export type DeliveryFailure = 'timeout' | 'rejected-recipient' | 'provider-error';

export class DeliveryError extends Error {
  constructor(
    readonly reason: DeliveryFailure,
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

/**
 * Hands a message to one channel's provider. `signal` aborts when the send budget runs out;
 * adapters stop waiting and release their connection. Throws `DeliveryError` for failures the
 * adapter recognises.
 */
export abstract class MessageSender {
  abstract send(message: OutboundMessage, signal: AbortSignal): Promise<Delivery>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const SMS_SENDER = Symbol('SMS_SENDER');
