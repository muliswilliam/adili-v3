import { createHmac } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { messages, type schema } from '../db/schema.js';
import {
  DeliveryError,
  type DeliveryFailure,
  EMAIL_SENDER,
  type MessageSender,
  SMS_SENDER,
} from './message-sender.js';
import type { SendMessage } from './send-message.schema.js';
import { type Channel, renderTemplate } from './templates.js';

export const MESSAGES_OPTIONS = Symbol('MESSAGES_OPTIONS');

export interface MessagesOptions {
  providerTimeoutMs: number;
  recipientHashKey: string;
}

/** notifications.yaml `Message`. */
export interface MessageView {
  id: string;
  channel: Channel;
  template: string;
  status: 'sent' | 'failed';
  error: string | null;
  providerMessageId: string | null;
  createdAt: string;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    @Inject(EMAIL_SENDER) private readonly email: MessageSender,
    @Inject(SMS_SENDER) private readonly sms: MessageSender,
    @Inject(MESSAGES_OPTIONS) private readonly options: MessagesOptions,
  ) {}

  /**
   * Renders the template, hands it to the channel's provider within the budget and records the
   * outcome. Provider failures are an outcome (`failed` with a reason), not an error.
   */
  async send(request: SendMessage, caller: Principal): Promise<MessageView> {
    if (request.recipient.kind !== 'address') {
      // Unreachable: validation rejects person recipients until directory contacts exist.
      throw new Error('unsupported recipient kind');
    }
    const to = request.recipient.to;
    const content = renderTemplate(request.template, request.locale, request.params);
    const id = uuidv7();

    let providerMessageId: string | null = null;
    let error: DeliveryFailure | null = null;
    try {
      const sender = request.channel === 'email' ? this.email : this.sms;
      ({ providerMessageId } = await withBudget(this.options.providerTimeoutMs, (signal) =>
        sender.send({ to, ...content }, signal),
      ));
    } catch (failure) {
      error = failure instanceof DeliveryError ? failure.reason : 'provider-error';
      // Provider errors can quote the recipient, so log the reason and error type only.
      this.logger.warn(
        { messageId: id, template: request.template, reason: error, errorType: errorType(failure) },
        'Message not delivered to the provider',
      );
    }

    const [row] = await this.db
      .insert(messages)
      .values({
        id,
        channel: request.channel,
        template: request.template,
        locale: request.locale,
        recipientHash: this.hashRecipient(to),
        tenant: request.tenant ?? null,
        caller: callerOf(caller),
        status: error ? 'failed' : 'sent',
        providerMessageId,
        error,
      })
      .returning();
    if (!row) {
      throw new Error('insert returned no row');
    }
    return toView(row);
  }

  /** A message is visible only to the caller that sent it. */
  async get(id: string, caller: Principal): Promise<MessageView | undefined> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.caller, callerOf(caller))));
    return row && toView(row);
  }

  private hashRecipient(to: string): string {
    return createHmac('sha256', this.options.recipientHashKey)
      .update(to.toLowerCase())
      .digest('hex');
  }
}

/** Runs `work` with a signal that aborts after `ms`, and stops waiting at that point even if `work` ignores it. */
async function withBudget<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DeliveryError('timeout', `provider did not answer within ${ms}ms`);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Services are identified by OAuth client; tokens without one fall back to the subject. */
function callerOf(principal: Principal): string {
  return principal.clientId ?? principal.subject;
}

function toView(row: typeof messages.$inferSelect): MessageView {
  return {
    id: row.id,
    channel: row.channel,
    template: row.template,
    status: row.status,
    error: row.error,
    providerMessageId: row.providerMessageId,
    createdAt: row.createdAt.toISOString(),
  };
}
