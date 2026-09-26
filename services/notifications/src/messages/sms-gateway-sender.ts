import { z } from 'zod';

import {
  type Delivery,
  DeliveryError,
  MessageSender,
  type OutboundMessage,
} from './message-sender.js';

export interface SmsGatewaySenderOptions {
  /** `POST` endpoint of the gateway (packages/schemas/external/sms.yaml `sendMessage`). */
  url: string;
  senderId: string;
}

const accepted = z.object({ message_id: z.string().min(1) });
const rejected = z.object({ to: z.array(z.string()).optional() });

/** SMS through the gateway contract served by the SMS mock in development. */
export class SmsGatewaySender extends MessageSender {
  constructor(private readonly options: SmsGatewaySenderOptions) {
    super();
  }

  async send(message: OutboundMessage, signal: AbortSignal): Promise<Delivery> {
    // Aborting rejects with the signal's reason, the budget's timeout DeliveryError.
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        to: message.to,
        sender_id: this.options.senderId,
        message: message.text,
      }),
      signal,
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status === 400 && rejected.safeParse(body).data?.to) {
      throw new DeliveryError('rejected-recipient', 'SMS gateway refused the recipient');
    }
    if (!response.ok) {
      throw new DeliveryError('provider-error', `SMS gateway answered ${response.status}`);
    }
    const parsed = accepted.safeParse(body);
    if (!parsed.success) {
      throw new DeliveryError('provider-error', 'SMS gateway answered without a message id');
    }
    return { providerMessageId: parsed.data.message_id };
  }
}
