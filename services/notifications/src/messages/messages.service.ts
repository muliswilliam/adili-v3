import { createHmac } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { callerOf, errorType, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  ContactLookupError,
  type PersonContacts,
  PersonContactsSource,
} from '../contacts/person-contacts.js';
import { messages, type schema } from '../db/schema.js';
import {
  DeliveryError,
  type DeliveryFailure,
  EMAIL_SENDER,
  type MessageSender,
  SMS_SENDER,
} from './message-sender.js';
import type { MessageView } from './representation.js';
import type { SendMessage } from './send-message.schema.js';
import { renderTemplate } from './templates.js';

export const MESSAGES_OPTIONS = Symbol('MESSAGES_OPTIONS');

export interface MessagesOptions {
  /** The send budget: contact lookup (person recipients) and provider together. */
  providerTimeoutMs: number;
  /** The most of the budget a contact lookup may take. */
  contactLookupTimeoutMs: number;
  recipientHashKey: string;
}

/**
 * Why a message was not sent. Besides the provider's reasons: `no-contact` (the person has no
 * verified contact for the channel) and `contact-lookup-failed` (the directory did not answer;
 * worth retrying).
 */
export type MessageFailure = DeliveryFailure | 'no-contact' | 'contact-lookup-failed';

type Resolution = { to: string } | { failure: 'no-contact' | 'contact-lookup-failed' };

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    @Inject(EMAIL_SENDER) private readonly email: MessageSender,
    @Inject(SMS_SENDER) private readonly sms: MessageSender,
    @Inject(MESSAGES_OPTIONS) private readonly options: MessagesOptions,
    private readonly contacts: PersonContactsSource,
  ) {}

  /**
   * Resolves the recipient, renders the template, hands it to the channel's provider within the
   * budget and records the outcome. A person without a contact for the channel, a failed contact
   * lookup and provider failures are outcomes (`failed` with a reason), not errors.
   */
  async send(request: SendMessage, caller: Principal): Promise<MessageView> {
    const deadline = Date.now() + this.options.providerTimeoutMs;
    const content = renderTemplate(request.template, request.locale, request.params);
    const id = uuidv7();

    const resolution = await this.resolve(request, id);
    let providerMessageId: string | null = null;
    let error: MessageFailure | null = 'failure' in resolution ? resolution.failure : null;
    if ('to' in resolution) {
      const { to } = resolution;
      try {
        const sender = request.channel === 'email' ? this.email : this.sms;
        ({ providerMessageId } = await withBudget(deadline - Date.now(), (signal) =>
          sender.send({ to, ...content }, signal),
        ));
      } catch (failure) {
        error = failure instanceof DeliveryError ? failure.reason : 'provider-error';
        // Provider errors can quote the recipient, so log the reason and error type only.
        this.logger.warn(
          {
            messageId: id,
            template: request.template,
            reason: error,
            errorType: errorType(failure),
          },
          'Message not delivered to the provider',
        );
      }
    }

    const [row] = await this.db
      .insert(messages)
      .values({
        id,
        channel: request.channel,
        template: request.template,
        locale: request.locale,
        recipientHash: 'to' in resolution ? this.hashRecipient(resolution.to) : null,
        recipientPersonId: request.recipient.kind === 'person' ? request.recipient.personId : null,
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

  /** The address to send to: given, or the person's verified contact for the channel. */
  private async resolve(request: SendMessage, messageId: string): Promise<Resolution> {
    const { recipient } = request;
    if (recipient.kind === 'address') {
      return { to: recipient.to };
    }
    let contacts: PersonContacts;
    try {
      contacts = await withTimeout(
        this.options.contactLookupTimeoutMs,
        () => new ContactLookupError('contact lookup ran out of time'),
        () => this.contacts.lookup(recipient.personId),
      );
    } catch (failure) {
      this.logger.warn(
        { messageId, template: request.template, errorType: errorType(failure) },
        'Contacts of the person could not be looked up',
      );
      return { failure: 'contact-lookup-failed' };
    }
    const to = request.channel === 'email' ? contacts.email : contacts.phone;
    return to ? { to } : { failure: 'no-contact' };
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
  return withTimeout(
    ms,
    () => {
      const error = new DeliveryError('timeout', `provider did not answer within ${ms}ms`);
      controller.abort(error);
      return error;
    },
    () => work(controller.signal),
  );
}

/** Rejects with `onTimeout()` once `ms` have passed, whether or not `work` has settled. */
async function withTimeout<T>(
  ms: number,
  onTimeout: () => Error,
  work: () => Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        reject(onTimeout());
      },
      Math.max(0, ms),
    );
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
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
