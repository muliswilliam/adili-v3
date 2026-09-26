import type { OnApplicationShutdown } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import {
  type Delivery,
  DeliveryError,
  MessageSender,
  type OutboundMessage,
} from './message-sender.js';

export interface SmtpSenderOptions {
  host: string;
  port: number;
  from: string;
  /** Connection, greeting and socket timeout; the caller's budget also bounds the whole send. */
  timeoutMs: number;
  /** Refuse to send unless the server upgrades the connection with STARTTLS. */
  requireTls: boolean;
}

/** Email over SMTP (Mailpit in development). */
export class SmtpSender extends MessageSender implements OnApplicationShutdown {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpSenderOptions) {
    super();
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      // STARTTLS is used when the server offers it, and mandatory with `requireTls`.
      secure: false,
      requireTLS: options.requireTls,
      connectionTimeout: options.timeoutMs,
      greetingTimeout: options.timeoutMs,
      socketTimeout: options.timeoutMs,
    });
  }

  async send(message: OutboundMessage, signal: AbortSignal): Promise<Delivery> {
    // Nodemailer cannot cancel a send; the budget stops the caller waiting instead. A send that
    // outlives the budget may still be delivered, so callers treat `timeout` as delivery unknown.
    signal.throwIfAborted();
    try {
      const info = await this.transport.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { providerMessageId: info.messageId };
    } catch (error) {
      throw toDeliveryError(error);
    }
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}

function toDeliveryError(error: unknown): unknown {
  const { code, responseCode } = error as { code?: string; responseCode?: number };
  if (code === 'EENVELOPE' && responseCode !== undefined && responseCode >= 500) {
    return new DeliveryError(
      'rejected-recipient',
      `SMTP server refused the recipient (${responseCode})`,
    );
  }
  if (code === 'ETIMEDOUT') {
    return new DeliveryError('timeout', 'SMTP server timed out');
  }
  return error;
}
