import { randomUUID } from 'node:crypto';

import {
  NotificationsClient,
  type PersonMessage,
  type SentMessage,
} from '../../src/notifications/notifications-client.js';

/**
 * The notifications messages API for tests: every message is recorded as sent, once per
 * idempotency key, as the real service replays a repeated key.
 */
export class FakeNotifications extends NotificationsClient {
  readonly sent: PersonMessage[] = [];
  private readonly byKey = new Map<string, SentMessage>();

  reset(): void {
    this.sent.length = 0;
    this.byKey.clear();
  }

  send(message: PersonMessage): Promise<SentMessage> {
    const replayed = this.byKey.get(message.idempotencyKey);
    if (replayed) return Promise.resolve(replayed);
    const sent: SentMessage = { id: randomUUID(), status: 'sent', error: null };
    this.byKey.set(message.idempotencyKey, sent);
    this.sent.push(structuredClone(message));
    return Promise.resolve(sent);
  }
}
