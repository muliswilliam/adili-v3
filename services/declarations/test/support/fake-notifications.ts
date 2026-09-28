import { randomUUID } from 'node:crypto';

import {
  NotificationsClient,
  NotificationsUnavailable,
  type ReminderChannel,
  type ReminderMessage,
  type SendOutcome,
} from '../../src/notifications/notifications-client.js';

/** How the fake answers a channel: sent, a notifications failure reason, or unreachable. */
export type FakeAnswer = 'sent' | 'unreachable' | { failed: string };

/**
 * The notifications messages API for tests: records every reminder asked for and answers `sent`
 * with a fresh message id, unless a channel is given other answers (consumed in order, the last
 * one repeating).
 */
export class FakeNotifications extends NotificationsClient {
  readonly sent: (ReminderMessage & { messageId: string | null })[] = [];
  private readonly answers = new Map<ReminderChannel, FakeAnswer[]>();

  answer(channel: ReminderChannel, ...answers: FakeAnswer[]): void {
    this.answers.set(channel, answers);
  }

  sendReminder(message: ReminderMessage): Promise<SendOutcome> {
    const queue = this.answers.get(message.channel) ?? [];
    const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? 'sent';
    if (answer === 'unreachable') {
      this.sent.push({ ...message, messageId: null });
      return Promise.reject(new NotificationsUnavailable('notifications unreachable'));
    }
    if (answer === 'sent') {
      const messageId = randomUUID();
      this.sent.push({ ...message, messageId });
      return Promise.resolve({ status: 'sent', messageId });
    }
    this.sent.push({ ...message, messageId: null });
    return Promise.resolve({ status: 'failed', error: answer.failed });
  }

  channels(): ReminderChannel[] {
    return this.sent.map((message) => message.channel);
  }

  reset(): void {
    this.sent.length = 0;
    this.answers.clear();
  }
}
