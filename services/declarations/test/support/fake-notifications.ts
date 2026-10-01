import { randomUUID } from 'node:crypto';

import {
  NotificationsClient,
  NotificationsKeyReused,
  NotificationsUnavailable,
  type ReminderChannel,
  type ReminderMessage,
  type SendOutcome,
} from '../../src/notifications/notifications-client.js';

/**
 * How the fake answers a channel: sent, a notifications failure reason, unreachable (never got
 * there), or `lost`: sent, but the answer never came back (a timeout after notifications stored it
 * under the key).
 */
export type FakeAnswer = 'sent' | 'unreachable' | 'lost' | { failed: string };

/**
 * The notifications messages API for tests: records every reminder asked for (`sent`, replays
 * included) and answers `sent`
 * with a fresh message id, unless a channel is given other answers (consumed in order, the last
 * one repeating). Like the real API it keeps each `Idempotency-Key`'s request and answer: the
 * same request again gets the stored answer (nothing sent), another body under the key is
 * refused (422, `NotificationsKeyReused`).
 */
export class FakeNotifications extends NotificationsClient {
  readonly sent: (ReminderMessage & { messageId: string | null })[] = [];
  private readonly answers = new Map<ReminderChannel, FakeAnswer[]>();
  private readonly keys = new Map<string, { request: string; outcome: SendOutcome }>();

  answer(channel: ReminderChannel, ...answers: FakeAnswer[]): void {
    this.answers.set(channel, answers);
  }

  sendReminder(message: ReminderMessage): Promise<SendOutcome> {
    const { idempotencyKey, ...body } = message;
    const request = JSON.stringify(body);
    const stored = this.keys.get(idempotencyKey);
    if (stored) {
      const { outcome } = stored;
      this.sent.push({
        ...message,
        messageId: outcome.status === 'sent' ? outcome.messageId : null,
      });
      return stored.request === request
        ? Promise.resolve(outcome)
        : Promise.reject(new NotificationsKeyReused('Idempotency-Key reused for another body'));
    }
    const queue = this.answers.get(message.channel) ?? [];
    const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? 'sent';
    if (answer === 'unreachable') {
      this.sent.push({ ...message, messageId: null });
      return Promise.reject(new NotificationsUnavailable('notifications unreachable'));
    }
    if (answer === 'sent' || answer === 'lost') {
      const messageId = randomUUID();
      this.sent.push({ ...message, messageId });
      const outcome: SendOutcome = { status: 'sent', messageId };
      this.keys.set(idempotencyKey, { request, outcome });
      return answer === 'lost'
        ? Promise.reject(new NotificationsUnavailable('no answer in time'))
        : Promise.resolve(outcome);
    }
    this.sent.push({ ...message, messageId: null });
    const outcome: SendOutcome = { status: 'failed', error: answer.failed };
    this.keys.set(idempotencyKey, { request, outcome });
    return Promise.resolve(outcome);
  }

  channels(): ReminderChannel[] {
    return this.sent.map((message) => message.channel);
  }

  reset(): void {
    this.sent.length = 0;
    this.answers.clear();
    this.keys.clear();
  }
}
